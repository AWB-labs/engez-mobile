// Compact one-line live scoreboard, pinned during a turn so every role
// (describer, guesser, spectator) always knows where the game stands.
// Port of client/src/components/ScoreStrip.jsx, tightened for mobile: each
// cell is just the team's dot + score so the whole strip fits a 44px band.
// Cells are solid white so they read on the violet stage; the active team's
// cell is lifted with its own accentSurface pastel.

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  accentSurface,
  color,
  depth,
  inkOn,
  radius,
  space,
  tabularNums,
  teamColor,
  type,
} from '../theme';
import type { Team } from '../lib/protocol';

export interface ScoreStripProps {
  teams: Team[];
  activeTeamId?: string | null;
}

export default function ScoreStrip({ teams, activeTeamId }: ScoreStripProps) {
  // Leaders first, mirroring the web strip — the sort is stable enough that
  // cells only swap when the score order actually changes.
  const sorted = [...teams].sort((a, b) => b.score - a.score);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.row}
    >
      {sorted.map((t) => {
        const tint = teamColor(t.color);
        const active = t.id === activeTeamId;
        return (
          <View
            key={t.id}
            style={[styles.cell, depth.low, active ? accentSurface(tint) : styles.cellIdle]}
            accessible
            accessibilityLabel={`${t.name}: ${t.score} points${active ? ', playing now' : ''}`}
          >
            <View style={[styles.dot, { backgroundColor: tint }]} />
            <Text style={[styles.score, tabularNums]}>{t.score}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexGrow: 0, // hug the row; never stretch into the screen below
    maxHeight: 44,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.chip,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    minHeight: 32,
  },
  cellIdle: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: inkOn.hairline,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  // Poster type at the shared word-md token — same size TitleCard's md uses.
  score: {
    ...type.wordMd,
    color: color.ink,
  },
});
