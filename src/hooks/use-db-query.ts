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
    /** Re-run when a query parameter changes. */
    queryKey?: string;
  } = {}
): DbQueryState<T> {
  const { events, refreshOnFocus = true, queryKey } = options;
  const db = useSQLiteContext();

  const [result, setResult] = useState<{ key: string | undefined; data: T }>();
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
  const latest = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async () => {
    const request = ++latest.current;
    try {
      const data = await runRef.current(db);
      if (!mountedRef.current || request !== latest.current) return;
      setResult({ key: queryKey, data });
      setError(null);
    } catch (caught) {
      if (!mountedRef.current || request !== latest.current) return;
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      if (mountedRef.current && request === latest.current) setLoading(false);
    }
  }, [db, queryKey]);

  useEffect(() => {
    if (!refreshOnFocus) void execute();
  }, [execute, refreshOnFocus]);

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

  const refresh = useCallback(() => void execute(), [execute]);
  const current = result?.key === queryKey ? result : undefined;
  return { data: current?.data, loading: loading || Boolean(result && !current && !error), error, refresh };
}
