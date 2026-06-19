import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

type PlaylistItem = {
  id: string;
  path: string;
  name: string;
  url: string;
};

function fmt(t: number) {
  if (!Number.isFinite(t)) return "00:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const [name, setName] = useState("No video selected");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  function playVideo(list: PlaylistItem[], index: number) {
    const video = videoRef.current;
    const item = list[index];

    if (!video || !item) return;

    video.pause();
    video.currentTime = 0;
    video.src = item.url;
    video.controls = true;

    setCurrentIndex(index);
    setName(item.name);
    setPlaying(false);
    setTime(0);
    setDuration(0);

    video.play().catch((e) => {
      console.error("Cannot play video:", e);
    });
  }

  async function openVideo() {
    const files = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: "Video",
          extensions: ["mp4", "mkv", "webm", "mov", "avi"],
        },
      ],
    });

    if (!Array.isArray(files) || files.length === 0) return;

    const items: PlaylistItem[] = [];

    for (const file of files) {
      const id = crypto.randomUUID();

      const videoUrl = await invoke<string>("load_video_to_memory", {
        id,
        path: file,
      });

      items.push({
        id,
        path: file,
        name: file.split(/[\\/]/).pop() || file,
        url: videoUrl,
      });
    }

    setPlaylist(items);
    playVideo(items, 0);
  }

  async function togglePlay() {
    const video = videoRef.current;
    if (!video || !video.src) return;

    try {
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
    } catch (e) {
      console.error("Cannot play video:", e);
    }
  }

  function seekBy(seconds: number) {
    const video = videoRef.current;
    if (!video || !duration) return;

    video.currentTime = Math.max(
      0,
      Math.min(video.currentTime + seconds, duration)
    );
  }

  function seekTo(value: number) {
    const video = videoRef.current;
    if (!video || !duration) return;

    video.currentTime = value;
    setTime(value);
  }

  function setVideoVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;

    video.volume = value;
    setVolume(value);
  }

  function playNext() {
    if (!playlist.length) return;

    const nextIndex = currentIndex + 1;

    if (nextIndex >= playlist.length) {
      setPlaying(false);
      return;
    }

    playVideo(playlist, nextIndex);
  }

  function playPrevious() {
    if (!playlist.length) return;

    const prevIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
    playVideo(playlist, prevIndex);
  }

  async function toggleFullscreen() {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (video.requestFullscreen) {
        await video.requestFullscreen();
        return;
      }

      if ((video as any).webkitEnterFullscreen) {
        (video as any).webkitEnterFullscreen();
        return;
      }
    } catch (err) {
      console.warn("Browser fullscreen failed, using Tauri fullscreen:", err);
    }

    const win = getCurrentWindow();
    const fullscreen = await win.isFullscreen();
    await win.setFullscreen(!fullscreen);
    setIsFullscreen(!fullscreen);
  }

  useEffect(() => {
    function keyboardHandler(e: KeyboardEvent) {
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case "ArrowLeft":
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;

        case "ArrowRight":
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
          break;

        case " ":
          e.preventDefault();
          togglePlay();
          break;

        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;

        case "n":
          playNext();
          break;

        case "p":
          playPrevious();
          break;
      }
    }

    window.addEventListener("keydown", keyboardHandler);
    return () => window.removeEventListener("keydown", keyboardHandler);
  }, [playlist, currentIndex, duration]);

  return (
    <div className={`app ${isFullscreen ? "fullscreen" : ""}`}>
      <aside className="sidebar">
        <h2>Playlist</h2>

        <div className="playlist">
          {playlist.length === 0 && (
            <div className="playlist-item">
              <div className="thumb">🎬</div>
              <div>
                <strong>No video selected</strong>
                <span>Ready</span>
              </div>
            </div>
          )}

          {playlist.map((item, index) => (
            <div
              key={item.id}
              className={`playlist-item ${
                index === currentIndex ? "active" : ""
              }`}
              onClick={() => playVideo(playlist, index)}
            >
              <div className="thumb">🎬</div>
              <div>
                <strong>{item.name}</strong>
                <span>{index === currentIndex ? "Playing" : "Ready"}</span>
              </div>
            </div>
          ))}
        </div>

        <button className="open-btn" onClick={openVideo}>
          📁 Open Videos
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{name === "No video selected" ? "Tauri Video Player" : name}</h1>
          <button onClick={toggleFullscreen}>⛶</button>
        </header>

        <section className="player-card">
          <div className="video-box">
            <video
              ref={videoRef}
              className="video"
              preload="metadata"
              playsInline
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration || 0);
                e.currentTarget.volume = volume;
              }}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={playNext}
              onError={(e) =>
                console.error("Video error:", e.currentTarget.error)
              }
            />
          </div>

          <div className="controls">
            <button onClick={playPrevious}>⏮</button>

            <button onClick={() => seekBy(-10)}>↺ 10</button>

            <button className="play-btn" onClick={togglePlay}>
              {playing ? "Pause" : "Play"}
            </button>

            <button onClick={() => seekBy(10)}>10 ↻</button>

            <button onClick={playNext}>⏭</button>

            <span className="time">
              {fmt(time)} / {fmt(duration)}
            </span>

            <div className="volume">
              🔊
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVideoVolume(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="progress-row">
            <input
              className="progress"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={time}
              onChange={(e) => seekTo(Number(e.target.value))}
            />
          </div>
        </section>
      </main>
    </div>
  );
}