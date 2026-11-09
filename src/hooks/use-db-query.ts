/**
 * Reading from SQLite in a screen.
 *
 * This is the whole cache-invalidation story: SQLite is the source of truth, screens
 * re-read on focus and when a repository emits a matching event. No query library,
 * because there is no remote data to cache and a second source of truth over the one
 * we already have would only be somewhere for staleness to hide.
 */
import { useFocusEffect } from 'expo-router';
import { type SQLiteDatabase, useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type DbEvent, onAny } from '@/db/events';

export type DbQueryState<T> = {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
};

export function useDbQuery<T>(
  run: (db: SQLiteDatabase) => Promise<T>,
  options: {
    /** Re-run whenever one of these is emitted. */
    events?: readonly DbEvent[];
    /** Re-run when the screen regains focus. Default true. */
    refreshOnFocus?: boolean;
  } = {}
): DbQueryState<T> {
  const { events, refreshOnFocus = true } = options;
  const db = useSQLiteContext();

  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Keep the latest callback without making it a dependency, so an inline arrow
  // function at the call site does not re-run the query on every render. Assigned in
  // an effect rather than during render, which React forbids.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async () => {
    try {
      const result = await runRef.current(db);
      if (!mountedRef.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void execute();
  }, [execute]);

  useEffect(() => {
    if (!events?.length) return;
    return onAny(events, () => {
      void execute();
    });
  }, [events, execute]);

  useFocusEffect(
    useCallback(() => {
      if (refreshOnFocus) void execute();
    }, [execute, refreshOnFocus])
  );

  return { data, loading, error, refresh: () => void execute() };
}
