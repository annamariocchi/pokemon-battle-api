import express from 'express';
import cors from 'cors';
import { Battle } from '@pkmn/sim';
import { Dex } from '@pkmn/dex';
import { Teams } from '@pkmn/sets';

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store for active non-PvP battles
// Map: battleId (string) -> Battle instance
const activeBattles = new Map();

// Helper to generate a random battle ID
const generateId = () => Math.random().toString(36).substring(2, 10);

/**
 * Endpoint to start a new PvE battle.
 * Expects { playerTeam, opponentTeam, playerContext } in the body.
 * playerContext can contain format rules or custom seeds if needed.
 */
app.post('/api/battle/start', (req, res) => {
    try {
        const { p1, p2 } = req.body;

        if (!p1 || !p2) {
            return res.status(400).json({ error: 'Missing p1 or p2 team configurations.' });
        }

        // Initialize a new battle instance using the loaded pkmn/sim
        const battleOptions = {
            formatid: 'gen9customgame', // Keep format flexible to allow all mons/moves
            debug: true,
            strictChoices: false,
        };

        const battle = new Battle(Object.assign({
            send: (type, data) => {
                // You can stream logs here, but typically we read them out after
            }
        }, battleOptions));

        const battleId = generateId();

        // Sanitize teams to ensure required fields (like moves) exist
        const sanitizeTeam = (team) => {
            if (!Array.isArray(team)) return [];
            return team.map(mon => {
                const safeMon = { ...mon };
                if (!safeMon.moves || !Array.isArray(safeMon.moves) || safeMon.moves.length === 0) {
                    safeMon.moves = ['Tackle']; // Fallback
                }
                // Ensure moves are strings (IDs)
                safeMon.moves = safeMon.moves.map(m => typeof m === 'string' ? m : m.name || m.id || 'tackle');
                return safeMon;
            });
        };

        const safeP1Team = sanitizeTeam(p1.team);
        const safeP2Team = sanitizeTeam(p2.team);

        // Setup Players
        battle.setPlayer('p1', { name: p1.name || 'Player', team: safeP1Team });
        battle.setPlayer('p2', { name: p2.name || 'Wild Pokemon', team: safeP2Team });

        // Store battle in memory
        activeBattles.set(battleId, battle);

        // Force both players to select their lead Pokemon to pass teampreview
        // In @pkmn/sim, makeChoices() can auto-resolve if needed, but explicitly sending team 1 is safer
        battle.choose('p1', 'team 1');
        battle.choose('p2', 'team 1');
        battle.makeChoices(); // Force the turn to resolve if it's waiting

        // Read the initial start log
        const log = battle.log.join('\n');
        battle.log = []; // Clear log for next fetch

        // Extract basic state info
        const state = {
            p1Active: battle.p1.active[0] ? {
                hp: battle.p1.active[0].hp,
                maxhp: battle.p1.active[0].maxhp,
                fainted: battle.p1.active[0].fainted
            } : null,
            p2Active: battle.p2.active[0] ? {
                hp: battle.p2.active[0].hp,
                maxhp: battle.p2.active[0].maxhp,
                fainted: battle.p2.active[0].fainted
            } : null,
            ended: battle.ended,
            winner: battle.winner
        };

        res.json({
            success: true,
            battleId,
            log: log,
            state: state
        });

    } catch (e) {
        console.error("Start Battle Error:", e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * Endpoint for a player to send an action (move, switch, run).
 */
app.post('/api/battle/action', (req, res) => {
    try {
        const { battleId, action } = req.body;

        if (!battleId || !activeBattles.has(battleId)) {
            return res.status(404).json({ success: false, error: 'Battle not found or expired.' });
        }

        const battle = activeBattles.get(battleId);

        // 1) Apply Player's choice
        battle.choose('p1', action);

        // 2) Apply AI's choice (Automated Random Wild AI for now)
        let p2Choice = 'auto'; // Let sim auto-pick if possible
        const p2Active = battle.p2.active[0];

        if (p2Active && !p2Active.fainted) {
            const validMoves = p2Active.moveSlots.map((m, idx) => idx + 1);
            if (validMoves.length > 0) {
                p2Choice = `move ${validMoves[Math.floor(Math.random() * validMoves.length)]}`;
            }
        }

        battle.choose('p2', p2Choice);

        // 3) Commit the choices
        const log = battle.log.join('\n');
        battle.log = []; // Clear log for the next turn

        // Extract basic state info
        const state = {
            p1Active: battle.p1.active[0] ? {
                hp: battle.p1.active[0].hp,
                maxhp: battle.p1.active[0].maxhp,
                fainted: battle.p1.active[0].fainted
            } : null,
            p2Active: battle.p2.active[0] ? {
                hp: battle.p2.active[0].hp,
                maxhp: battle.p2.active[0].maxhp,
                fainted: battle.p2.active[0].fainted
            } : null,
            ended: battle.ended,
            winner: battle.winner
        };

        if (battle.ended) {
            activeBattles.delete(battleId);
        }

        res.json({
            success: true,
            log: log,
            state: state
        });

    } catch (e) {
        console.error("Action Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * Health check endpoint
 */
app.get('/', (req, res) => res.send('Pokémon Battle API is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Battle API listening on port ${PORT}`);
});
