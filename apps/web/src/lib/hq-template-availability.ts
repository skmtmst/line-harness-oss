/**
 * The HQ distribution UI must not be exposed before its Worker routes are deployed.
 * Deployments turn this on only after the route contract and its integration tests pass.
 */
export const HQ_TEMPLATE_DISTRIBUTION_ENABLED =
  process.env.NEXT_PUBLIC_HQ_TEMPLATE_DISTRIBUTION_ENABLED === '1'
