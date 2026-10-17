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
  } catch {
    console.error('deployment_safety_check_failed');
    process.exitCode = 1;
  }
}

main();
