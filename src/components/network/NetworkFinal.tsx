import { NetworkPlayer } from '../../types';

interface NetworkFinalProps {
  rankings: NetworkPlayer[];
  onClose: () => void;
}

const RANK_EMOJI = ['🥇', '🥈', '🥉'];

export function NetworkFinal({ rankings, onClose }: NetworkFinalProps) {
  const top3 = rankings.slice(0, 3);

  return (
    <div className="net-final">
      <div className="net-final-title">🏆 Résultats finaux</div>

      {/* Podium */}
      <div className="net-podium">
        {[top3[1], top3[0], top3[2]].map((p, di) => {
          if (!p) return <div key={di} className="net-podium-slot" />;
          const heights = [90, 120, 70];
          const classes = ['second', 'first', 'third'];
          return (
            <div key={p.name} className={`net-podium-slot net-podium-${classes[di]}`}>
              <div className="net-podium-avatar">{p.name.slice(0, 2).toUpperCase()}</div>
              <div className="net-podium-name">{p.name}</div>
              <div className="net-podium-score">{p.score.toLocaleString('fr')} pts</div>
              <div className="net-podium-bar" style={{ height: heights[di] }}>
                {RANK_EMOJI[di === 1 ? 0 : di === 0 ? 1 : 2]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Full list */}
      <div className="net-final-list">
        {rankings.map((p, i) => (
          <div key={p.name} className="net-lb-row" style={{ animationDelay: `${i * 0.05}s` }}>
            <span className="net-lb-rank">{RANK_EMOJI[i] ?? i + 1}</span>
            <span className="net-lb-name">{p.name}</span>
            <span className="net-lb-score">{p.score.toLocaleString('fr')} pts</span>
          </div>
        ))}
      </div>

      <button className="net-action-btn net-action-end" onClick={onClose}>
        Terminer
      </button>
    </div>
  );
}
