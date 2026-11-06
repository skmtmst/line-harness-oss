import { inspectDeployment } from './deployment-safety';

// 配備の仕組みから呼ぶ入口。実行方式（cjs／esm）に関係なく、必ず確かめを実行する。
async function main(): Promise<void> {
  const environment = process.argv[2];
  const configPath = process.argv[3];
  if (!['production', 'staging'].includes(environment) || !configPath) {
    console.error('deployment_safety_arguments_invalid');
    process.exitCode = 1;
    return;
  }
  try {
    const failures = await inspectDeployment(configPath, environment as 'production' | 'staging', process.env.CLOUDFLARE_API_TOKEN ?? '', process.env.CLOUDFLARE_ACCOUNT_ID ?? '');
    console.log(JSON.stringify({ check: 'deployment_safety', environment, failures }));
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    // 失敗の種類だけを出す（決まった名前の物だけ。鍵や本文は出さない）。
    const message = error instanceof Error ? error.message : '';
    const code = /^deployment_safety_[a-z_]+(:[0-9]{3}:[a-z0-9_-]+)?$/.test(message) ? message : 'unexpected';
    console.error(`deployment_safety_check_failed ${code}`);
    process.exitCode = 1;
  }
}

main();
