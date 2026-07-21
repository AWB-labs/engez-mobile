// Landing screen — the poster. Port of client/src/screens/Home.jsx.
//
// Behaviour matches the web client: name + host, or name + code + join, with
// the join code filtered to the server's room-code alphabet. Two deliberate
// departures, both from the design brief:
//   - the join row is always visible (no reveal toggle) — two decisive
//     actions, zero ceremony;
//   - a missing name nudges inline instead of silently disabling the buttons,
//     so the screen explains itself. Errors stay an inline danger card, never
//     an alert.
// The name persists to AsyncStorage so regulars never retype it.

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChevronDown, ChevronUp, CircleAlert, LogIn, Play } from 'lucide-react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import Card from '../components/Card';
import Chip from '../components/Chip';
import { initSound } from '../lib/sound';
import type { GameActions, GameStatus } from '../lib/useGame';
import {
  accentSurface,
  color,
  duration,
  easing,
  HIT_SLOP,
  ICON_STROKE,
  icon,
  inkOn,
  radius,
  space,
  STAGGER_MS,
  stageOn,
  tabularNums,
  type,
} from '../theme';

interface HomeProps {
  status: GameStatus;
  error: string;
  actions: GameActions;
}

/** Persisted display name — regulars never retype it. */
const NAME_KEY = 'teamtaboo:name';

/** Room-code alphabet (server/engine.js CODE_ALPHABET) — no I, L, O, 0, 1. */
const NOT_CODE = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;

/** The shortest code the server has ever minted (web client's join gate). */
const MIN_CODE = 3;

/** The amber underline sweep under the wordmark — the Home "poster hero". */
const SWEEP_WIDTH = 120;
const SWEEP_HEIGHT = 4;

/** Arabic runs read right-to-left even inside a Latin sentence (§7). */
const rtl = { writingDirection: 'rtl' as const };

export default function Home({ status, error, actions }: HomeProps) {
  const reduceMotion = useReducedMotion();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [howOpen, setHowOpen] = useState(false);
  // Which requirement the last tap tripped over — rendered inline, never as
  // an alert, and self-clearing the moment typing satisfies it.
  const [nudge, setNudge] = useState<'name' | 'code' | null>(null);

  // Don't let a slow AsyncStorage read clobber a name typed before it lands.
  const nameTouched = useRef(false);

  const joining = status === 'joining';

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(NAME_KEY)
      .then((saved) => {
        if (!cancelled && saved && !nameTouched.current) setName(saved);
      })
      .catch(() => {
        // Storage unavailable — an empty field is a fine fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeName = (text: string) => {
    nameTouched.current = true;
    setName(text);
    AsyncStorage.setItem(NAME_KEY, text).catch(() => {});
  };

  const changeCode = (text: string) => {
    setCode(text.toUpperCase().replace(NOT_CODE, ''));
  };

  // Both entry points warm the sound engine — the same job as the web
  // client's unlockAudio() on the first meaningful tap.
  const host = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNudge('name');
      return;
    }
    setNudge(null);
    void initSound();
    actions.createGame(trimmed);
  };

  const join = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNudge('name');
      return;
    }
    if (code.length < MIN_CODE) {
      setNudge('code');
      return;
    }
    setNudge(null);
    void initSound();
    actions.joinGame(trimmed, code);
  };

  // The underline sweep: a 4px amber bar that grows out of its left edge on
  // mount. RN scales around the centre, so a matching translateX pins the
  // left edge in place — transform-only, per §2.4. Reduced motion: plain fade.
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withTiming(1, { duration: duration.celebratory, easing: easing.out });
  }, [sweep]);
  const sweepStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: sweep.value }
      : {
          opacity: 1,
          transform: [
            { translateX: -(SWEEP_WIDTH / 2) * (1 - sweep.value) },
            { scaleX: sweep.value },
          ],
        },
  );

  return (
    <Screen scroll contentStyle={styles.content}>
      {/* Poster hero */}
      <View style={styles.hero}>
        <Text style={styles.wordmark} accessibilityRole="header">
          Khammen
        </Text>
        <Animated.View style={[styles.sweep, sweepStyle]} />
        <Text style={styles.pitch}>Describe the words. Beat the clock. Win as a team.</Text>
      </View>

      <Card style={styles.formCard}>
        <Text style={styles.fieldLabel}>Your name</Text>
        <TextInput
          value={name}
          onChangeText={changeName}
          placeholder="e.g. Alex"
          placeholderTextColor={inkOn.tertiary}
          maxLength={20}
          autoCorrect={false}
          returnKeyType="done"
          selectionColor={color.violet}
          style={[styles.inputSurface, styles.nameInput]}
          accessibilityLabel="Your name"
        />
        {nudge === 'name' && !name.trim() ? (
          <Text style={styles.nudge}>Add your name first</Text>
        ) : null}

        {error ? (
          <Animated.View
            entering={FadeInDown.duration(duration.standard)}
            style={[styles.errorCard, accentSurface(color.danger)]}
          >
            <CircleAlert size={icon.md} color={color.danger} strokeWidth={ICON_STROKE} />
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        ) : null}

        <Button
          title={joining ? 'Connecting…' : 'Host a game'}
          icon={Play}
          onPress={host}
          disabled={joining}
          style={styles.hostButton}
        />

        <Text style={[styles.fieldLabel, styles.joinLabel]}>Or join with a code</Text>
        <View style={styles.joinRow}>
          <TextInput
            value={code}
            onChangeText={changeCode}
            placeholder="CODE"
            placeholderTextColor={inkOn.tertiary}
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={join}
            selectionColor={color.violet}
            style={[styles.inputSurface, styles.codeInput]}
            accessibilityLabel="Room code"
          />
          <Button
            title={joining ? 'Connecting…' : 'Join'}
            icon={LogIn}
            variant="ghost"
            onPress={join}
            disabled={joining}
          />
        </View>
        {nudge === 'code' && code.length < MIN_CODE ? (
          <Text style={styles.nudge}>Enter the room code to join</Text>
        ) : null}
      </Card>

      {/* Collapsible rules — the web README's three lines, emoji-free. */}
      <Pressable
        onPress={() => setHowOpen((v) => !v)}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityState={{ expanded: howOpen }}
        style={styles.howToggle}
      >
        <Chip label={howOpen ? 'Hide' : 'How to play'} icon={howOpen ? ChevronUp : ChevronDown} />
      </Pressable>
      {howOpen && (
        <Card soft style={styles.howCard}>
          {/* §2.4: list reveals stagger 50ms per line (skipped under reduced
              motion by reanimated's default ReduceMotion.System). */}
          <Animated.View entering={FadeInDown.duration(duration.standard)}>
            <Text style={styles.rule}>
              Your team's describer gets 5 words and 40 seconds — no saying the word!
            </Text>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(STAGGER_MS).duration(duration.standard)}>
            <Text style={styles.rule}>
              Teammates type every guess (franco or <Text style={rtl}>عربي</Text>, both count) to
              score.
            </Text>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(2 * STAGGER_MS).duration(duration.standard)}>
            <Text style={styles.rule}>
              Exact = +2, close spelling = +1. First team to the target wins.
            </Text>
          </Animated.View>
        </Card>
      )}

      <Text style={styles.footer}>4+ players · 2+ teams · plays on any phone</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Centre the poster in the viewport; scroll only when the keyboard or the
  // opened rules card make it taller than the screen.
  content: {
    justifyContent: 'center',
    paddingVertical: space.xxl,
  },
  hero: {
    alignItems: 'center',
    marginBottom: space.xxl,
  },
  wordmark: {
    ...type.displayXl,
    color: stageOn.primary,
    textAlign: 'center',
  },
  sweep: {
    width: SWEEP_WIDTH,
    height: SWEEP_HEIGHT,
    borderRadius: radius.chip,
    backgroundColor: color.cta,
    // No margin: Lalezar's line box already leaves a generous gap under the
    // wordmark (its descent is 0.59em, for Arabic tails the Latin never uses).
    marginTop: 0,
  },
  pitch: {
    ...type.body,
    color: stageOn.secondary,
    textAlign: 'center',
    marginTop: space.lg,
  },
  formCard: {
    padding: space.xl,
  },
  fieldLabel: {
    ...type.overline,
    color: inkOn.tertiary,
    marginBottom: space.sm,
  },
  joinLabel: {
    marginTop: space.xl,
  },
  // Inputs ≥ 16px font; input radius token, hairline-strong ring on grey.
  inputSurface: {
    backgroundColor: color.soft,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: inkOn.hairlineStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  nameInput: {
    ...type.body,
    color: color.ink,
  },
  // Monospace-feel for the code: poster type, centred, tracked out, tabular.
  codeInput: {
    ...type.title,
    ...tabularNums,
    color: color.ink,
    textAlign: 'center',
    letterSpacing: 4,
    flex: 1,
  },
  nudge: {
    ...type.caption,
    color: color.warn,
    marginTop: space.sm,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.md,
  },
  errorText: {
    ...type.caption,
    color: inkOn.primary,
    flex: 1,
  },
  hostButton: {
    marginTop: space.xl,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  howToggle: {
    alignSelf: 'center',
    marginTop: space.xl,
  },
  howCard: {
    padding: space.lg,
    gap: space.sm,
    marginTop: space.md,
  },
  rule: {
    ...type.caption,
    color: inkOn.secondary,
  },
  footer: {
    ...type.caption,
    color: stageOn.tertiary,
    textAlign: 'center',
    marginTop: space.xl,
  },
});
