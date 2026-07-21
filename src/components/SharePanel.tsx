// Room invite panel: join code + copy / native share / QR.
// Port of client/src/components/Share.jsx. The link and QR carry the code,
// so they act as the "key" to the room — nobody has to type anything.

import { useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Copy, QrCode, Share2 } from 'lucide-react-native';
import Card from './Card';
import Button from './Button';
import { joinLink } from '../config';
import { color, inkOn, radius, space, tabularNums, type } from '../theme';

export interface SharePanelProps {
  code: string;
}

export default function SharePanel({ code }: SharePanelProps) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = joinLink(code);
  const shareText = `Join my Engez game! Tap to enter (code ${code}): ${url}`;

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = () => {
    // Fire-and-forget — the optimistic "Copied" flip is the feedback.
    Clipboard.setStringAsync(url).catch(() => {});
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const nativeShare = () => {
    // Rejection = user dismissed the sheet — nothing to do.
    Share.share({ message: shareText }).catch(() => {});
  };

  return (
    <Card>
      <Text style={styles.overline}>Room code</Text>
      <Text style={[styles.code, tabularNums]} accessibilityLabel={`Room code ${code}`}>
        {code}
      </Text>

      <View style={styles.actions}>
        <Button
          title={copied ? 'Copied' : 'Copy'}
          onPress={copy}
          variant="ghost"
          icon={Copy}
          style={styles.action}
        />
        <Button title="Share" onPress={nativeShare} variant="ghost" icon={Share2} style={styles.action} />
        <Button
          title="QR"
          onPress={() => setShowQr((v) => !v)}
          variant="ghost"
          icon={QrCode}
          style={styles.action}
        />
      </View>

      {showQr && (
        <View style={styles.qrWrap}>
          {/* A bordered white tile gives scanners a clean quiet zone. */}
          <View style={styles.qrCard}>
            <QRCode value={url} size={160} color={color.ink} backgroundColor={color.card} />
          </View>
          <Text style={styles.qrHint}>Scan to jump straight into the room</Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  overline: {
    ...type.overline,
    color: inkOn.tertiary,
    textAlign: 'center',
  },
  code: {
    ...type.displayXl,
    color: color.ink,
    textAlign: 'center',
    letterSpacing: 6,
    marginTop: space.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.lg,
  },
  action: {
    flex: 1,
  },
  qrWrap: {
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
  },
  qrCard: {
    backgroundColor: color.card,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: inkOn.hairlineStrong,
    padding: space.md,
  },
  qrHint: {
    ...type.caption,
    color: inkOn.tertiary,
  },
});
