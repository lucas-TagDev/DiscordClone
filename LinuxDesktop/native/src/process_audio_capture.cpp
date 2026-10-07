// Captures the audio of a single program (or of everything except this app) on
// Windows through WASAPI process loopback, and streams 48 kHz stereo float PCM
// to JavaScript.
//
// The Electron API only exposes whole-device loopback ("loopback"), which mixes
// the voice of the other call participants into the screen share. Process
// loopback lets us target one process tree instead, or exclude our own tree so
// the call audio never reaches the share.

#include <node_api.h>

#include <windows.h>

#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <wrl/implements.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

constexpr wchar_t kProcessLoopbackVirtualDevice[] = L"VAD\\Process_Loopback";
constexpr UINT32 kSampleRate = 48000;
constexpr UINT16 kChannelCount = 2;
constexpr UINT16 kBitsPerSample = 16;
constexpr REFERENCE_TIME kBufferDuration = 200000;  // 20 ms, in 100-ns units
constexpr DWORD kActivationTimeoutMs = 5000;
constexpr DWORD kPacketWaitMs = 200;
constexpr int kMinimumSupportedBuild = 19041;  // Windows 10 2004

std::string Narrow(const std::wstring& value) {
  if (value.empty()) {
    return std::string();
  }
  int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                                 nullptr, 0, nullptr, nullptr);
  if (size <= 0) {
    return std::string();
  }
  std::string result(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(),
                      size, nullptr, nullptr);
  return result;
}

std::wstring DescribeHresult(const wchar_t* stage, HRESULT hr) {
  wchar_t buffer[256];
  swprintf_s(buffer, L"%ls falhou (0x%08X)", stage, static_cast<unsigned int>(hr));
  return buffer;
}

int ReadWindowsBuildNumber() {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", 0,
                    KEY_READ | KEY_WOW64_64KEY, &key) != ERROR_SUCCESS) {
    return 0;
  }

  wchar_t buffer[64] = {};
  DWORD size = sizeof(buffer) - sizeof(wchar_t);
  DWORD type = 0;
  LSTATUS status = RegQueryValueExW(key, L"CurrentBuildNumber", nullptr, &type,
                                    reinterpret_cast<LPBYTE>(buffer), &size);
  RegCloseKey(key);
  if (status != ERROR_SUCCESS) {
    return 0;
  }
  return static_cast<int>(wcstol(buffer, nullptr, 10));
}

bool IsProcessLoopbackSupported() { return ReadWindowsBuildNumber() >= kMinimumSupportedBuild; }

// Waits for ActivateAudioInterfaceAsync to finish so activation failures can be
// reported back to JavaScript instead of producing a silent stream.
class ActivationHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>,
                          IActivateAudioInterfaceCompletionHandler, FtmBase> {
 public:
  ActivationHandler() : completed_(CreateEventW(nullptr, FALSE, FALSE, nullptr)) {}

  ~ActivationHandler() {
    if (completed_ != nullptr) {
      CloseHandle(completed_);
    }
  }

  HANDLE completed() const { return completed_; }

  HRESULT result() const { return result_; }

  ComPtr<IAudioClient> client() const { return client_; }

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activate_result = E_FAIL;
    ComPtr<IUnknown> unknown;
    HRESULT hr = operation->GetActivateResult(&activate_result, unknown.GetAddressOf());
    if (SUCCEEDED(hr) && SUCCEEDED(activate_result)) {
      hr = unknown.As(&client_);
    }
    result_ = FAILED(hr) ? hr : activate_result;
    if (completed_ != nullptr) {
      SetEvent(completed_);
    }
    return S_OK;
  }

 private:
  HANDLE completed_;
  HRESULT result_ = E_FAIL;
  ComPtr<IAudioClient> client_;
};

struct AudioChunk {
  std::vector<float> samples;
};

void CallJsOnData(napi_env env, napi_value js_callback, void* /*context*/, void* data) {
  // The chunk is owned by this callback, even when the environment is gone.
  std::unique_ptr<AudioChunk> chunk(static_cast<AudioChunk*>(data));
  if (env == nullptr || js_callback == nullptr) {
    return;
  }

  size_t byte_length = chunk->samples.size() * sizeof(float);
  void* raw = nullptr;
  napi_value array_buffer = nullptr;
  if (napi_create_arraybuffer(env, byte_length, &raw, &array_buffer) != napi_ok) {
    return;
  }
  if (byte_length > 0) {
    std::memcpy(raw, chunk->samples.data(), byte_length);
  }

  napi_value typed_array = nullptr;
  if (napi_create_typedarray(env, napi_float32_array, chunk->samples.size(), array_buffer, 0,
                             &typed_array) != napi_ok) {
    return;
  }

  napi_value global = nullptr;
  napi_get_global(env, &global);
  napi_value result = nullptr;
  napi_call_function(env, global, js_callback, 1, &typed_array, &result);
}

class ProcessAudioCapture {
 public:
  ~ProcessAudioCapture() { Stop(); }

  bool Start(napi_env env, napi_value callback, uint32_t target_process_id, bool include_tree,
             std::wstring* error) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (running_) {
        *error = L"a captura por processo ja esta em andamento";
        return false;
      }
      if (target_process_id == 0) {
        *error = L"processo alvo invalido";
        return false;
      }
    }

    napi_value resource_name = nullptr;
    napi_create_string_utf8(env, "partiuchat-process-audio-capture", NAPI_AUTO_LENGTH,
                            &resource_name);

    napi_threadsafe_function on_data = nullptr;
    if (napi_create_threadsafe_function(env, callback, nullptr, resource_name, 0, 1, nullptr,
                                       nullptr, nullptr, CallJsOnData,
                                       &on_data) != napi_ok) {
      *error = L"falha ao criar o canal de dados com o JavaScript";
      return false;
    }

    HANDLE started = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (started == nullptr) {
      napi_release_threadsafe_function(on_data, napi_tsfn_release);
      *error = L"falha ao criar o evento de sincronizacao";
      return false;
    }

    {
      std::lock_guard<std::mutex> lock(mutex_);
      on_data_ = on_data;
      started_event_ = started;
      start_error_.clear();
      stop_requested_.store(false);
      running_ = true;
    }

    thread_ = std::thread(&ProcessAudioCapture::ThreadMain, this, target_process_id, include_tree);

    DWORD wait = WaitForSingleObject(started, kActivationTimeoutMs + 2000);
    if (wait != WAIT_OBJECT_0) {
      *error = L"tempo esgotado ao iniciar a captura por processo";
      Stop();
      return false;
    }

    std::wstring failure;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      failure = start_error_;
    }
    if (!failure.empty()) {
      *error = failure;
      Stop();
      return false;
    }
    return true;
  }

  void Stop() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!running_) {
        return;
      }
      running_ = false;
      stop_requested_.store(true);
    }

    if (thread_.joinable()) {
      thread_.join();
    }

    if (on_data_ != nullptr) {
      napi_release_threadsafe_function(on_data_, napi_tsfn_release);
      on_data_ = nullptr;
    }
    if (started_event_ != nullptr) {
      CloseHandle(started_event_);
      started_event_ = nullptr;
    }
  }

  // Used at environment teardown: the loopback thread must not keep running and
  // the threadsafe function cannot be released while the environment is gone.
  void AbandonForExit() {
    std::lock_guard<std::mutex> lock(mutex_);
    running_ = false;
    stop_requested_.store(true);
    if (thread_.joinable()) {
      thread_.detach();
    }
    on_data_ = nullptr;
    if (started_event_ != nullptr) {
      CloseHandle(started_event_);
      started_event_ = nullptr;
    }
  }

 private:
  void ThreadMain(uint32_t target_process_id, bool include_tree) {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool acquired = napi_acquire_threadsafe_function(on_data_) == napi_ok;

    ComPtr<IAudioClient> audio_client;
    ComPtr<IAudioCaptureClient> capture_client;
    HANDLE packet_event = nullptr;
    std::wstring error;

    if (!acquired) {
      error = L"canal de dados com o JavaScript ja encerrado";
    } else if (FAILED(hr)) {
      error = DescribeHresult(L"CoInitializeEx", hr);
    }

    if (error.empty()) {
      AUDIOCLIENT_ACTIVATION_PARAMS activation_params = {};
      activation_params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
      activation_params.ProcessLoopbackParams.TargetProcessId = target_process_id;
      activation_params.ProcessLoopbackParams.ProcessLoopbackMode =
          include_tree ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                       : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

      PROPVARIANT activate_blob = {};
      activate_blob.vt = VT_BLOB;
      activate_blob.blob.cbSize = sizeof(activation_params);
      activate_blob.blob.pBlobData = reinterpret_cast<BYTE*>(&activation_params);

      ComPtr<ActivationHandler> handler = Make<ActivationHandler>();
      ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
      hr = ActivateAudioInterfaceAsync(kProcessLoopbackVirtualDevice, __uuidof(IAudioClient),
                                       &activate_blob, handler.Get(), operation.GetAddressOf());
      if (FAILED(hr)) {
        error = DescribeHresult(L"ActivateAudioInterfaceAsync", hr);
      } else if (WaitForSingleObject(handler->completed(), kActivationTimeoutMs) != WAIT_OBJECT_0) {
        error = L"tempo esgotado ao ativar o dispositivo de captura por processo";
      } else if (FAILED(handler->result())) {
        error = DescribeHresult(L"ativacao do dispositivo de captura", handler->result());
      } else {
        audio_client = handler->client();
        if (audio_client == nullptr) {
          error = L"cliente de audio indisponivel";
        }
      }
    }

    if (error.empty()) {
      WAVEFORMATEX format = {};
      format.wFormatTag = WAVE_FORMAT_PCM;
      format.nChannels = kChannelCount;
      format.nSamplesPerSec = kSampleRate;
      format.wBitsPerSample = kBitsPerSample;
      format.nBlockAlign = static_cast<WORD>(format.nChannels * format.wBitsPerSample / 8);
      format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

      hr = audio_client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                    AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                    kBufferDuration, 0, &format, nullptr);
      if (FAILED(hr)) {
        error = DescribeHresult(L"IAudioClient::Initialize", hr);
      }
    }

    if (error.empty()) {
      packet_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
      if (packet_event == nullptr) {
        error = L"falha ao criar o evento de captura";
      } else if (FAILED(hr = audio_client->SetEventHandle(packet_event))) {
        error = DescribeHresult(L"IAudioClient::SetEventHandle", hr);
      } else if (FAILED(hr = audio_client->GetService(IID_PPV_ARGS(capture_client.GetAddressOf())))) {
        error = DescribeHresult(L"IAudioClient::GetService", hr);
      } else if (FAILED(hr = audio_client->Start())) {
        error = DescribeHresult(L"IAudioClient::Start", hr);
      }
    }

    {
      std::lock_guard<std::mutex> lock(mutex_);
      start_error_ = error;
      if (started_event_ != nullptr) {
        SetEvent(started_event_);
      }
    }

    if (error.empty()) {
      std::vector<float> silence(static_cast<size_t>(kChannelCount), 0.0f);
      while (!stop_requested_.load()) {
        DWORD wait = WaitForSingleObject(packet_event, kPacketWaitMs);
        if (stop_requested_.load()) {
          break;
        }
        if (wait != WAIT_OBJECT_0) {
          continue;
        }

        UINT32 available_frames = 0;
        while (SUCCEEDED(capture_client->GetNextPacketSize(&available_frames)) &&
               available_frames > 0) {
          BYTE* data = nullptr;
          UINT32 frames = 0;
          DWORD flags = 0;
          if (FAILED(capture_client->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) {
            break;
          }

          auto chunk = std::make_unique<AudioChunk>();
          chunk->samples.resize(static_cast<size_t>(frames) * kChannelCount);
          if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nullptr) {
            std::fill(chunk->samples.begin(), chunk->samples.end(), 0.0f);
          } else {
            const int16_t* source = reinterpret_cast<const int16_t*>(data);
            for (size_t index = 0; index < chunk->samples.size(); ++index) {
              chunk->samples[index] = static_cast<float>(source[index]) / 32768.0f;
            }
          }

          capture_client->ReleaseBuffer(frames);

          if (frames > 0 && !chunk->samples.empty()) {
            if (napi_call_threadsafe_function(on_data_, chunk.get(), napi_tsfn_nonblocking) ==
                napi_ok) {
              chunk.release();
            }
          }

          if (FAILED(capture_client->GetNextPacketSize(&available_frames))) {
            break;
          }
        }
      }

      audio_client->Stop();
    }

    if (packet_event != nullptr) {
      CloseHandle(packet_event);
    }
    if (SUCCEEDED(hr)) {
      CoUninitialize();
    }
    if (acquired) {
      napi_release_threadsafe_function(on_data_, napi_tsfn_release);
    }
  }

  std::mutex mutex_;
  std::thread thread_;
  std::atomic<bool> stop_requested_{false};
  napi_threadsafe_function on_data_ = nullptr;
  HANDLE started_event_ = nullptr;
  std::wstring start_error_;
  bool running_ = false;
};

ProcessAudioCapture g_capture;

void EnvironmentCleanup(void* /*data*/) { g_capture.AbandonForExit(); }

napi_value ThrowTypeError(napi_env env, const char* message) {
  napi_throw_type_error(env, nullptr, message);
  return nullptr;
}

napi_value ThrowError(napi_env env, const std::wstring& message) {
  std::string narrowed = Narrow(message);
  napi_throw_error(env, nullptr, narrowed.c_str());
  return nullptr;
}

napi_value IsSupported(napi_env env, napi_callback_info /*info*/) {
  napi_value result = nullptr;
  napi_get_boolean(env, IsProcessLoopbackSupported(), &result);
  return result;
}

napi_value GetWindowProcessId(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1] = {};
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return ThrowTypeError(env, "getWindowProcessId espera o handle da janela");
  }

  double handle_value = 0;
  if (napi_get_value_double(env, args[0], &handle_value) != napi_ok) {
    return ThrowTypeError(env, "handle da janela invalido");
  }

  DWORD process_id = 0;
  GetWindowThreadProcessId(reinterpret_cast<HWND>(static_cast<uintptr_t>(handle_value)),
                           &process_id);

  napi_value result = nullptr;
  napi_create_uint32(env, process_id, &result);
  return result;
}

napi_value GetProcessImageName(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1] = {};
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  uint32_t process_id = 0;
  if (argc < 1 || napi_get_value_uint32(env, args[0], &process_id) != napi_ok) {
    return ThrowTypeError(env, "getProcessImageName espera o id do processo");
  }

  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  std::wstring image_name;
  if (process != nullptr) {
    wchar_t buffer[MAX_PATH] = {};
    DWORD size = MAX_PATH;
    if (QueryFullProcessImageNameW(process, 0, buffer, &size)) {
      image_name = buffer;
    }
    CloseHandle(process);
  }

  napi_value result = nullptr;
  napi_create_string_utf8(env, Narrow(image_name).c_str(), NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value StartCapture(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2] = {};
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return ThrowTypeError(env, "startCapture espera (opcoes, callback)");
  }

  napi_valuetype options_type = napi_undefined;
  napi_typeof(env, args[0], &options_type);
  if (options_type != napi_object) {
    return ThrowTypeError(env, "opcoes invalidas para startCapture");
  }

  napi_valuetype callback_type = napi_undefined;
  napi_typeof(env, args[1], &callback_type);
  if (callback_type != napi_function) {
    return ThrowTypeError(env, "callback invalido para startCapture");
  }

  if (!IsProcessLoopbackSupported()) {
    return ThrowError(env, L"captura por processo requer Windows 10 2004 ou superior");
  }

  napi_value process_id_value = nullptr;
  uint32_t process_id = 0;
  if (napi_get_named_property(env, args[0], "processId", &process_id_value) != napi_ok ||
      napi_get_value_uint32(env, process_id_value, &process_id) != napi_ok) {
    return ThrowTypeError(env, "processId invalido para startCapture");
  }

  bool include_tree = true;
  napi_value include_tree_value = nullptr;
  if (napi_get_named_property(env, args[0], "includeTree", &include_tree_value) == napi_ok) {
    napi_get_value_bool(env, include_tree_value, &include_tree);
  }

  std::wstring error;
  if (!g_capture.Start(env, args[1], process_id, include_tree, &error)) {
    return ThrowError(env, error);
  }

  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value StopCapture(napi_env env, napi_callback_info /*info*/) {
  g_capture.Stop();
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"isSupported", nullptr, IsSupported, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
      {"getWindowProcessId", nullptr, GetWindowProcessId, nullptr, nullptr, nullptr,
       napi_enumerable, nullptr},
      {"getProcessImageName", nullptr, GetProcessImageName, nullptr, nullptr, nullptr,
       napi_enumerable, nullptr},
      {"startCapture", nullptr, StartCapture, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
      {"stopCapture", nullptr, StopCapture, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
  };

  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  napi_add_env_cleanup_hook(env, EnvironmentCleanup, nullptr);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
