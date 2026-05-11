import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AudioFileInfo } from '../types';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useDownloadedFiles(downloadDir: string) {
  const [files, setFiles] = useState<AudioFileInfo[]>([]);

  const refresh = useCallback(async () => {
    if (!downloadDir) return;
    try {
      const result = await invoke<AudioFileInfo[]>('scan_downloaded_files', { dir: downloadDir });
      setFiles(result);
    } catch {
      setFiles([]);
    }
  }, [downloadDir]);

  useEffect(() => { refresh(); }, [refresh]);

  const isDownloaded = useCallback((title: string, artist: string): boolean => {
    const normTitle = normalize(title);
    const normArtist = normalize(artist);
    return files.some((f) => {
      const n = normalize(f.name);
      return n.includes(normTitle) && n.includes(normArtist);
    });
  }, [files]);

  return { files, refresh, isDownloaded };
}
