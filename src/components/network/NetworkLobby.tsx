import { NetworkPlayer } from '../../types';

interface NetworkLobbyProps {
  pin: string;
  players: NetworkPlayer[];
  onStart: (totalRounds: number) => void;
  onClose: () => void;
}

export function NetworkLobby({ pin, players, onStart, onClose }: NetworkLobbyProps) {
  const handleStart = () => onStart(10);

  return (
    <div className="net-lobby">
      <div className="net-lobby-header">
        <button className="net-back-btn" onClick={onClose}>←</button>
        <span className="net-lobby-title">Salle en ligne</span>
      </div>

      <div className="net-pin-block">
        <div className="net-pin-label">Code d'accès</div>
        <div className="net-pin-value">{pin}</div>
        <div className="net-pin-hint">
          Les joueurs ouvrent <strong>quiz.stan-bouchet.fr</strong> sur leur téléphone
        </div>
      </div>

      <div className="net-players-header">
        <span className="net-players-title">Joueurs connectés</span>
        <span className="net-players-count">{players.length}</span>
      </div>

      <div className="net-players-list">
        {players.length === 0 ? (
          <div className="net-players-empty">En attente de joueurs…</div>
        ) : (
          players.map((p) => (
            <div key={p.name} className="net-player-row">
              <div className="net-player-avatar">{p.name.slice(0, 2).toUpperCase()}</div>
              <div className="net-player-name">{p.name}</div>
            </div>
          ))
        )}
      </div>

      <button
        className="net-start-btn"
        onClick={handleStart}
        disabled={players.length === 0}
      >
        Lancer la partie ({players.length} joueur{players.length > 1 ? 's' : ''})
      </button>
    </div>
  );
}
