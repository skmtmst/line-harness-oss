import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { WebinarApp } from '../../../worker/src/client/webinar/main';
import { liffDocumentTitle } from '../components/ui/LiffHeader';
import { getIdToken, getLiffId, getLineUserId } from '../lib/liff-auth';

/** 申込・視聴・回答はWorkerの本体を共用する。旧URLも同じ本体へ渡す。 */
export default function Webinar() {
  const { slug = '' } = useParams<{ slug: string }>();
  const ctx = useMemo(() => ({
    liffId: getLiffId(), lineUserId: getLineUserId(), idToken: getIdToken(),
    apiBase: import.meta.env.VITE_API_BASE || window.location.origin,
  }), []);
  useEffect(() => {
    document.title = liffDocumentTitle('ウェビナー');
    document.body.classList.add('wb-active');
    return () => document.body.classList.remove('wb-active', 'wb-lock');
  }, []);
  return <WebinarApp ctx={ctx} slug={slug} />;
}
