import { useEffect, useRef, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { AudioFileInfo } from '../types';

interface MiniPlayerProps {
  files: AudioFileInfo[];
  onRequestRefresh: () => void;
  /** When set, immediately plays the file at the given path (from quiz jukebox). */
  externalPlay?: { path: string; ts: number } | null;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MiniPlayer({ files, onRequestRefresh, externalPlay }: MiniPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);   // 0-1
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showVolume, setShowVolume] = useState(false);

  const currentFile = currentIdx !== null ? files[currentIdx] : null;

  // External play trigger from quiz jukebox
  useEffect(() => {
    if (!externalPlay) return;
    const idx = files.findIndex((f) => f.path === externalPlay.path);
    if (idx >= 0) setCurrentIdx(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPlay]);

  // Load track when index changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentFile) return;
    audio.src = convertFileSrc(currentFile.path);
    audio.volume = volume;
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || 0);
    setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
  }, []);

  const handleEnded = useCallback(() => {
    if (files.length === 0 || currentIdx === null) return;
    const next = (currentIdx + 1) % files.length;
    setCurrentIdx(next);
  }, [currentIdx, files.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [handleTimeUpdate, handleEnded]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentIdx === null) {
      if (files.length === 0) return;
      setCurrentIdx(0);
      return;
    }
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const playPrev = () => {
    if (files.length === 0 || currentIdx === null) return;
    setCurrentIdx((currentIdx - 1 + files.length) % files.length);
  };

  const playNext = () => {
    if (files.length === 0) return;
    const next = currentIdx === null ? 0 : (currentIdx + 1) % files.length;
    setCurrentIdx(next);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  };

  if (files.length === 0) return null;

  return (
    <div className="mini-player">
      <audio ref={audioRef} />

      {/* Track info */}
      <div className="mini-player-info">
        <div className="mini-player-icon">
          {isPlaying ? (
            <div className="equalizer" style={{ height: 20 }}>
              <div className="equalizer-bar" />
              <div className="equalizer-bar" />
              <div className="equalizer-bar" />
            </div>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
          )}
        </div>
        <div className="mini-player-track">
          <span className="mini-player-name">{currentFile?.name ?? 'Aucune piste'}</span>
          <span className="mini-player-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mini-player-progress" onClick={seek}>
        <div className="mini-player-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Controls */}
      <div className="mini-player-controls">
        <button className="mini-btn" onClick={playPrev} title="Précédent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2"/></svg>
        </button>
        <button className="mini-btn mini-btn-play" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Lecture'}>
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          )}
        </button>
        <button className="mini-btn" onClick={playNext} title="Suivant">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2"/></svg>
        </button>

        {/* Volume */}
        <div className="mini-volume-wrap" onMouseLeave={() => setShowVolume(false)}>
          <button className="mini-btn" onMouseEnter={() => setShowVolume(true)} onClick={() => setShowVolume((s) => !s)} title="Volume">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              {volume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>}
              {volume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>}
            </svg>
          </button>
          {showVolume && (
            <div className="mini-volume-slider">
              <input
                type="range" min={0} max={1} step={0.05}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        {/* Refresh */}
        <button className="mini-btn" onClick={onRequestRefresh} title="Actualiser la liste">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>

        <span className="mini-player-count">{files.length} fichier{files.length > 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
