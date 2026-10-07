{
  "targets": [
    {
      "target_name": "process_audio_capture",
      "sources": ["src/process_audio_capture.cpp"],
      "defines": [
        "UNICODE",
        "_UNICODE",
        "_WIN32_WINNT=0x0A00",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX"
      ],
      "libraries": [
        "-lMmdevapi.lib",
        "-lOle32.lib",
        "-lUser32.lib",
        "-lAdvapi32.lib"
      ],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          }
        }]
      ]
    }
  ]
}
