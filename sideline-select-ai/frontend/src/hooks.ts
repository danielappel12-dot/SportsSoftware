import { useEffect, useRef, useState } from "react";
import { api, qs, type PhotoItem } from "./api";
import { useApp } from "./store";

export function usePhotos(query: Record<string, string | number | boolean | undefined | null>) {
  const { project, version } = useApp();
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(query);
  const seq = useRef(0);
  useEffect(() => {
    if (!project) return;
    const mine = ++seq.current;
    setLoading(true);
    api.get<{ total: number; items: PhotoItem[] }>(`/api/projects/${project.id}/photos${qs(query)}`)
      .then((r) => { if (mine === seq.current) { setItems(r.items); setTotal(r.total); setError(null); } })
      .catch((e: Error) => { if (mine === seq.current) setError(e.message); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, key, version]);
  return { items, total, loading, error };
}

export function useRoster(): Record<string, string> {
  const { project, version } = useApp();
  const [roster, setRoster] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!project) return;
    api.get<{ number: string; name: string }[]>(`/api/projects/${project.id}/roster`)
      .then((r) => setRoster(Object.fromEntries(r.map((x) => [x.number, x.name])))).catch(() => undefined);
  }, [project?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return roster;
}
