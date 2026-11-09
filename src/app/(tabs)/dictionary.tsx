import { ComingSoon } from '@/ui/coming-soon';

export default function DictionaryScreen() {
  return (
    <ComingSoon
      icon="search-outline"
      title="Dictionary"
      summary="Look up any Dutch word and keep the ones worth learning."
      bullets={[
        'Search in Dutch, English or Bulgarian.',
        'Entries show de/het, plural, verb forms and register, with a natural example.',
        'Anything looked up can be added to your phrase bank in one tap.',
        'Results are cached, so a word you have seen before opens instantly and offline.',
      ]}
    />
  );
}
