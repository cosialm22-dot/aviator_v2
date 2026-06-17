// Shared error-message helper. Every admin page and the marketer hub had its
// own byte-identical copy of this; it lives here now as the single source.
//
// Returns the Error's message when `e` is a real Error, otherwise a safe
// fallback. Callers that want a context-specific fallback pass one explicitly
// (e.g. errMsg(e, 'Could not save')).
export function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback;
}
