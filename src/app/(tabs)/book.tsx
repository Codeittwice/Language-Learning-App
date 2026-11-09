import { ComingSoon } from '@/ui/coming-soon';

export default function BookScreen() {
  return (
    <ComingSoon
      icon="book-outline"
      title="Book"
      summary="Work through your textbook with the words you do not know."
      bullets={[
        'Add your book, then a unit or a page range.',
        'Paste or type the words you got stuck on.',
        'Walk them one at a time: know it, or have it explained.',
        'Anything you keep joins the same review schedule as the rest.',
      ]}
    />
  );
}
