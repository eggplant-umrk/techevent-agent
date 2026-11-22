"use client";

import { useEffect } from "react";
import { NOTICE_MS, type ReadyNotice } from "@/lib/readyNotice";

/**
 * 画面の端（右下）に出す小さな知らせ：受信箱の依頼の候補づくりが終わったことを、どのタブにいても伝える。
 * 「開く」でその依頼を開き、×で閉じる。しばらくしたら自動で消える。ブラウザの通知（許可を求めるもの）は使わない
 */
export function ReadyNotices({ notices, onOpen, onClose }: { notices: ReadyNotice[]; onOpen: (id: string) => void; onClose: (id: string) => void }) {
  return (
    <div className="notices" role="region" aria-label="お知らせ" aria-live="polite">
      {notices.map((n) => (
        <Notice key={n.id} notice={n} onOpen={onOpen} onClose={onClose} />
      ))}
    </div>
  );
}

function Notice({ notice, onOpen, onClose }: { notice: ReadyNotice; onOpen: (id: string) => void; onClose: (id: string) => void }) {
  // 文が変わったら（同じ依頼の新しい知らせ）、消えるまでの時間を数え直す
  useEffect(() => {
    const t = setTimeout(() => onClose(notice.id), NOTICE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice.id, notice.text]);

  return (
    <div className={`notice notice-${notice.kind}`} role="status">
      <p className="notice-text">{notice.text}</p>
      <button type="button" className="btn btn-sm" onClick={() => onOpen(notice.id)}>
        開く
      </button>
      <button type="button" className="icon-btn" aria-label="知らせを閉じる" onClick={() => onClose(notice.id)}>
        ×
      </button>
    </div>
  );
}
