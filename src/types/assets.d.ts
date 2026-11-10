/**
 * Bundled media.
 *
 * Expo's own `expo/types` declares `*.css` and friends but no audio, so importing a
 * sound would otherwise be an implicit `any`. Metro resolves a bundled asset to a
 * numeric asset id, which is exactly what `expo-audio`'s `AudioSource` accepts for a
 * local file.
 */
declare module '*.wav' {
  const asset: number;
  export default asset;
}
