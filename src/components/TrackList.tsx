import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TrackInfo } from '../types';

interface TrackListProps {
  tracks: TrackInfo[];
  onAddToQueue: (tracks: TrackInfo[]) => void;
  isDownloaded?: (title: string, artist: string) => boolean;
  downloadDir?: string;
}

interface SelectedTrack extends TrackInfo {
  selected: boolean;
}

export function TrackList({ tracks, onAddToQueue, isDownloaded, downloadDir }: TrackListProps) {
  const [selectedTracks, setSelectedTracks] = useState<SelectedTrack[]>(
    tracks.map((track) => ({
      ...track,
      selected: isDownloaded ? !isDownloaded(track.title, track.artist) : true,
    }))
  );
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const selectedCount = selectedTracks.filter((t) => t.selected).length;
  const allSelected = selectedCount === selectedTracks.length;

  const handleToggleAll = () => {
    setSelectedTracks((prev) => prev.map((t) => ({ ...t, selected: !allSelected })));
  };

  const handleToggleTrack = (trackId: string) => {
    setSelectedTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, selected: !t.selected } : t))
    );
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownload = () => {
    if (selectedCount === 0) return;
    const toDownload: TrackInfo[] = selectedTracks
      .filter((t) => t.selected)
      .map(({ selected, ...track }) => track);
    onAddToQueue(toDownload);
  };

  const handleExportM3u = async () => {
    if (!downloadDir) return;
    try {
      const path = await invoke<string>('export_m3u', { dir: downloadDir });
      setExportMsg(`✓ Playlist exportée : ${path}`);
      setTimeout(() => setExportMsg(null), 4000);
    } catch (e) {
      setExportMsg(`Erreur : ${e}`);
      setTimeout(() => setExportMsg(null), 4000);
    }
  };

  return (
    <div className="track-list">
      <div className="track-list-header">
        <h3 className="track-list-title">Pistes disponibles</h3>
        <button className="toggle-select" onClick={handleToggleAll}>
          {allSelected ? 'Tout déselectionner' : 'Tout sélectionner'}
        </button>
      </div>

      <div className="track-list-items">
        {selectedTracks.map((track) => {
          const alreadyDl = isDownloaded?.(track.title, track.artist) ?? false;
          return (
            <label
              key={track.id}
              className={`track-item ${track.selected ? 'selected' : ''} ${alreadyDl ? 'already-downloaded' : ''}`}
            >
              <input
                type="checkbox"
                className="track-checkbox"
                checked={track.selected}
                onChange={() => handleToggleTrack(track.id)}
              />
              <div className="track-info">
                <div className="track-title">
                  {track.title}
                  {alreadyDl && <span className="track-dl-badge" title="Déjà téléchargé">✓</span>}
                </div>
                <div className="track-meta">
                  <span className="track-artist">{track.artist}</span>
                  <span className="track-duration">{formatDuration(track.duration_seconds)}</span>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {exportMsg && <p className="track-export-msg">{exportMsg}</p>}

      <div className="track-list-footer">
        <span className="track-count">
          {selectedCount} sur {selectedTracks.length} sélectionnée{selectedCount !== 1 ? 's' : ''}
        </span>
        <div className="track-footer-actions">
          {downloadDir && (
            <button className="export-m3u-btn" onClick={handleExportM3u} title="Exporter en .m3u">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
              .m3u
            </button>
          )}
          <button
            className="download-button"
            onClick={handleDownload}
            disabled={selectedCount === 0}
          >
            <span>⬇️</span>
            Télécharger ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
