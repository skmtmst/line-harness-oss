import { useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import LoadingView from '../components/LoadingView.js';
import LoadErrorView from '../components/LoadErrorView.js';
import { liffDocumentTitle } from '../components/ui/LiffHeader.js';

export default function Research() {
  const { id = '' } = useParams<{ id: string }>();
  const location = useLocation();
  const [formId, setFormId] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    document.title = liffDocumentTitle('リサーチ');
    setFormId(undefined); setFailed(false);
    api.researchForm(id).then(result => { if (active) setFormId(result.formId); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, attempt]);
  if (failed) return <LoadErrorView onRetry={() => setAttempt(value => value + 1)} />;
  if (!formId) return <LoadingView />;
  return <Navigate to={{ pathname: `/forms/${encodeURIComponent(formId)}`, search: location.search }} replace />;
}
