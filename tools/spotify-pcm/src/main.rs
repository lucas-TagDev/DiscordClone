//! spotify-pcm: ponte entre o bot de música e o motor de streaming do spotatui.
//!
//! Usa o fork do librespot mantido pelo spotatui para tocar uma faixa do Spotify e
//! escrever o áudio bruto no stdout (PCM s16le, 44.1kHz, estéreo), que o bot passa pelo
//! ffmpeg e publica no canal de voz. Um processo por faixa: o bot encerra o processo no
//! /skip ou /stop e para de ler o stdout no /pause (o librespot espera).
//!
//! Comandos:
//!   spotify-pcm login [--cache DIR]                  pareia a conta (código no navegador)
//!   spotify-pcm check [--cache DIR]                  confere o login salvo e o Premium
//!   spotify-pcm play  [--cache DIR] [--bitrate 96|160|320] [--normalize] <spotify:track:ID | ID | link>
//!
//! Tudo que não é áudio vai para o stderr. Códigos de saída: 0 ok, 1 erro, 2 sem login,
//! 3 faixa indisponível, 4 conta sem Premium, 5 Spotify recusou a chave de áudio da conta,
//! 64 uso incorreto.

use std::{env, io::Write, path::PathBuf, process::ExitCode, time::Duration};

use librespot_core::{
    SpotifyId, SpotifyUri, authentication::Credentials, cache::Cache, config::SessionConfig,
    session::Session,
};
use librespot_oauth::DeviceAuthClientBuilder;
use librespot_playback::{
    audio_backend,
    config::{AudioFormat, Bitrate, PlayerConfig},
    mixer::NoOpVolume,
    player::{Player, PlayerEvent},
};

/// Mesmo client id do spotatui (o `KEYMASTER_CLIENT_ID` do librespot): o Spotify aceita o
/// login por código de pareamento com ele, sem app de desenvolvedor.
const CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const SCOPES: [&str; 6] = [
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-library-read",
    "user-read-private",
];

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const LOAD_TIMEOUT: Duration = Duration::from_secs(45);
const ACCOUNT_INFO_WAIT: Duration = Duration::from_secs(3);

enum Failure {
    Usage(String),
    NoLogin,
    NotPremium(String),
    Unavailable(String),
    Other(String),
}

impl Failure {
    fn code(&self) -> u8 {
        match self {
            Failure::Other(_) => 1,
            Failure::NoLogin => 2,
            Failure::Unavailable(_) => 3,
            Failure::NotPremium(_) => 4,
            Failure::Usage(_) => 64,
        }
    }

    fn message(&self) -> String {
        match self {
            Failure::Usage(message) | Failure::Other(message) => message.clone(),
            Failure::NoLogin => {
                "nenhum login do Spotify salvo. Rode `spotify-pcm login` (ou `npm run spotify:login`) uma vez.".into()
            }
            Failure::NotPremium(kind) => format!(
                "a conta do Spotify não é Premium (tipo: {kind}). O streaming direto exige Premium."
            ),
            Failure::Unavailable(uri) => {
                format!("o Spotify não liberou o áudio desta faixa ({uri}); ela pode estar indisponível na sua região.")
            }
        }
    }
}

struct Args {
    command: String,
    cache_dir: PathBuf,
    bitrate: Bitrate,
    normalize: bool,
    target: Option<String>,
}

const USAGE: &str = "uso: spotify-pcm <login|check|play> [--cache DIR] [--bitrate 96|160|320] [--normalize] [spotify:track:ID]";

fn parse_args() -> Result<Args, Failure> {
    let mut raw = env::args().skip(1);
    let command = raw.next().ok_or_else(|| Failure::Usage(USAGE.into()))?;
    let mut args = Args {
        command,
        cache_dir: PathBuf::from(".spotify-cache"),
        bitrate: Bitrate::Bitrate320,
        normalize: false,
        target: None,
    };

    while let Some(arg) = raw.next() {
        match arg.as_str() {
            "--cache" => {
                let value = raw.next().ok_or_else(|| Failure::Usage("--cache precisa de um caminho".into()))?;
                args.cache_dir = PathBuf::from(value);
            }
            "--bitrate" => {
                args.bitrate = match raw.next().as_deref() {
                    Some("96") => Bitrate::Bitrate96,
                    Some("160") => Bitrate::Bitrate160,
                    Some("320") => Bitrate::Bitrate320,
                    _ => return Err(Failure::Usage("--bitrate aceita 96, 160 ou 320".into())),
                };
            }
            "--normalize" => args.normalize = true,
            "-h" | "--help" => return Err(Failure::Usage(USAGE.into())),
            value if value.starts_with("--") => {
                return Err(Failure::Usage(format!("opção desconhecida: {value}\n{USAGE}")));
            }
            value => args.target = Some(value.to_string()),
        }
    }

    Ok(args)
}

fn open_cache(dir: &PathBuf) -> Result<Cache, Failure> {
    std::fs::create_dir_all(dir)
        .map_err(|e| Failure::Other(format!("não consegui criar a pasta de cache {}: {e}", dir.display())))?;
    Cache::new(Some(dir.clone()), None, None, None)
        .map_err(|e| Failure::Other(format!("não consegui abrir o cache {}: {e}", dir.display())))
}

/// Conecta com as credenciais dadas ou com o login salvo no cache, e confere o Premium.
async fn connect(cache: Cache, credentials: Option<Credentials>) -> Result<Session, Failure> {
    let from_cache = credentials.is_none();
    let credentials = credentials.or_else(|| cache.credentials()).ok_or(Failure::NoLogin)?;
    let session = Session::new(SessionConfig::default(), Some(cache));

    match tokio::time::timeout(CONNECT_TIMEOUT, session.connect(credentials, true)).await {
        Err(_) => return Err(Failure::Other("o Spotify demorou demais para aceitar a conexão.".into())),
        Ok(Err(error)) => {
            let hint = if from_cache { " Se o login expirou, rode `spotify-pcm login` de novo." } else { "" };
            return Err(Failure::Other(format!("não consegui conectar no Spotify: {error}.{hint}")));
        }
        Ok(Ok(())) => {}
    }

    let started = std::time::Instant::now();
    while session.get_user_attribute("type").is_none() && started.elapsed() < ACCOUNT_INFO_WAIT {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if let Some(kind) = session.get_user_attribute("type") {
        if matches!(kind.as_str(), "free" | "open") {
            session.shutdown();
            return Err(Failure::NotPremium(kind));
        }
    }

    Ok(session)
}

async fn login(args: &Args) -> Result<(), Failure> {
    let cache = open_cache(&args.cache_dir)?;
    let client = DeviceAuthClientBuilder::new(CLIENT_ID, SCOPES.to_vec())
        .open_in_browser()
        .build()
        .map_err(|e| Failure::Other(format!("login do Spotify indisponível: {e}")))?;

    eprintln!("Confirme o código na página do Spotify que vai abrir no navegador.");
    let token = client
        .get_access_token_async()
        .await
        .map_err(|e| Failure::Other(format!("o login do Spotify falhou: {e}")))?;

    let session = connect(cache, Some(Credentials::with_access_token(token.access_token))).await?;
    eprintln!(
        "Login salvo para \"{}\" em {}. O bot já pode tocar áudio do Spotify.",
        session.username(),
        args.cache_dir.display()
    );
    session.shutdown();
    Ok(())
}

async fn check(args: &Args) -> Result<(), Failure> {
    let session = connect(open_cache(&args.cache_dir)?, None).await?;
    let kind = session.get_user_attribute("type").unwrap_or_else(|| "desconhecido".into());
    eprintln!("ok: conectado como \"{}\" (conta {kind}).", session.username());
    session.shutdown();
    Ok(())
}

/// Aceita `spotify:track:ID`, o ID base62 sozinho ou o link open.spotify.com/track/ID.
fn parse_track(value: &str) -> Result<SpotifyUri, Failure> {
    let invalid = || Failure::Usage(format!("faixa inválida: {value}"));
    let trimmed = value.trim();

    if trimmed.starts_with("spotify:") {
        return match SpotifyUri::from_uri(trimmed).map_err(|_| invalid())? {
            uri @ SpotifyUri::Track { .. } => Ok(uri),
            _ => Err(Failure::Usage("só faixas (spotify:track:...) são suportadas".into())),
        };
    }

    let id = trimmed
        .split_once("/track/")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed)
        .split(['?', '/', '#'])
        .next()
        .unwrap_or_default();
    let id = SpotifyId::from_base62(id).map_err(|_| invalid())?;
    Ok(SpotifyUri::Track { id })
}

async fn play(args: &Args) -> Result<(), Failure> {
    let target = args.target.as_deref().ok_or_else(|| Failure::Usage(USAGE.into()))?;
    let uri = parse_track(target)?;
    let session = connect(open_cache(&args.cache_dir)?, None).await?;

    let backend = audio_backend::find(Some("pipe".into()))
        .ok_or_else(|| Failure::Other("backend de áudio `pipe` indisponível nesta build".into()))?;
    let config = PlayerConfig {
        bitrate: args.bitrate,
        normalisation: args.normalize,
        gapless: false,
        ..PlayerConfig::default()
    };
    let player = Player::new(config, session.clone(), Box::new(NoOpVolume), move || {
        backend(None, AudioFormat::S16)
    });

    let mut events = player.get_player_event_channel();
    let label = target.to_string();
    player.load(uri, true, 0);

    // Até começar a tocar há um prazo; depois disso o bot pode pausar (parar de ler o
    // stdout) pelo tempo que quiser, então não há timeout.
    let mut started = false;
    let result = loop {
        let next = if started {
            events.recv().await
        } else {
            match tokio::time::timeout(LOAD_TIMEOUT, events.recv()).await {
                Ok(event) => event,
                Err(_) => break Err(Failure::Other("o Spotify demorou demais para começar a tocar a faixa.".into())),
            }
        };

        match next {
            Some(PlayerEvent::Playing { .. }) => started = true,
            Some(PlayerEvent::EndOfTrack { .. }) | Some(PlayerEvent::Stopped { .. }) => break Ok(()),
            Some(PlayerEvent::Unavailable { .. }) => break Err(Failure::Unavailable(label.clone())),
            Some(PlayerEvent::SessionDisconnected { .. }) => {
                break Err(Failure::Other("a conexão com o Spotify caiu durante a faixa.".into()));
            }
            Some(_) => {}
            None => break Err(Failure::Other("o player do Spotify encerrou sem terminar a faixa.".into())),
        }
    };

    player.stop();
    drop(player);
    let _ = std::io::stdout().flush();
    session.shutdown();
    result
}

/// Mensagem do bloqueio de chaves de áudio (o librespot só avisa pelo log).
const AUDIO_KEY_BLOCKED: &str = "o Spotify recusou a chave de áudio para esta conta (audio key error). \
Desde 2025 o Spotify bloqueia o librespot em algumas contas, principalmente nas mais novas; \
não há correção no motor. Faça `spotify-pcm login` com outra conta Premium mais antiga.";
const AUDIO_KEY_BLOCKED_CODE: i32 = 5;

/// Repassa os logs ao env_logger e encerra na hora quando o Spotify nega a chave de
/// áudio: sem ela o librespot baixaria a faixa inteira só para falhar no fim.
struct Logger {
    inner: env_logger::Logger,
}

impl log::Log for Logger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() == log::Level::Error || self.inner.enabled(metadata)
    }

    fn log(&self, record: &log::Record) {
        if record.level() == log::Level::Error && record.target().ends_with("audio_key") {
            eprintln!("spotify-pcm: {AUDIO_KEY_BLOCKED}");
            std::process::exit(AUDIO_KEY_BLOCKED_CODE);
        }
        self.inner.log(record);
    }

    fn flush(&self) {
        self.inner.flush();
    }
}

fn init_logger() {
    let inner = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(env_logger::Target::Stderr)
        .build();
    let max_level = inner.filter().max(log::LevelFilter::Error);
    if log::set_boxed_logger(Box::new(Logger { inner })).is_ok() {
        log::set_max_level(max_level);
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    init_logger();

    let outcome = match parse_args() {
        Err(failure) => Err(failure),
        Ok(args) => match args.command.as_str() {
            "login" => login(&args).await,
            "check" => check(&args).await,
            "play" => play(&args).await,
            other => Err(Failure::Usage(format!("comando desconhecido: {other}\n{USAGE}"))),
        },
    };

    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("spotify-pcm: {}", failure.message());
            ExitCode::from(failure.code())
        }
    }
}
