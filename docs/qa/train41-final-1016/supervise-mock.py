import subprocess,os,pathlib,json,datetime,signal
root=pathlib.Path('/tmp/ci-local-xhrhadvp/v8-screen-guard/work')
out=pathlib.Path('/tmp/train41-resume-1016')
node='/Users/kentakenta/lh-work/tools/hq/ci-local/runtime/node_modules/node/bin/node'
env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','TMPDIR','LANG','LC_ALL']};env.update(PORT='60018',NODE_ENV='test',TZ='UTC')
with (out/'supervised-mock.log').open('w') as log:
 p=subprocess.Popen([node,'scripts/visual-qa/mock-api.mjs'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 record={'pid':p.pid,'port':60018,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':str(root)}
 (out/'supervised-mock-status.json').write_text(json.dumps(record,indent=2)+'\n')
 def stop(sig,frame):
  p.terminate()
 signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
 print(json.dumps(record),flush=True)
 rc=p.wait();record.update(exit=rc,ended_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
 (out/'supervised-mock-status.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
