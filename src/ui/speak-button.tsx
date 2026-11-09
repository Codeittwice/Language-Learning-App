/**
 * Tap to hear something in Dutch.
 *
 * Reports honestly when no Dutch voice is installed instead of reading the text with
 * an English voice, which would teach the wrong pronunciation while looking fine.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable } from 'react-native';

import { checkDutchVoice, speakDutch } from '@/speech/tts';
import { useTheme } from '@/theme/use-theme';
import { tapFeedback } from '@/ui/button';

export type SpeakButtonProps = {
  text: string;
  size?: number;
  /** 0.6 for the Slower control. */
  rate?: number;
  color?: string;
};

export function SpeakButton({ text, size = 24, rate = 1, color }: SpeakButtonProps) {
  const theme = useTheme();
  const [hasVoice, setHasVoice] = useState(true);

  useEffect(() => {
    let active = true;
    void checkDutchVoice().then((voice) => {
      if (active) setHasVoice(voice.available);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hear it in Dutch"
      hitSlop={10}
      onPress={async () => {
        tapFeedback();
        const voice = await checkDutchVoice();
        if (!voice.available) {
          setHasVoice(false);
          Alert.alert('No Dutch voice installed', voice.instructions ?? '');
          return;
        }
        void speakDutch(text, { rate });
      }}
    >
      <Ionicons
        name={hasVoice ? 'volume-medium-outline' : 'volume-mute-outline'}
        size={size}
        color={color ?? (hasVoice ? theme.colors.accentText : theme.colors.textFaint)}
      />
    </Pressable>
  );
}
