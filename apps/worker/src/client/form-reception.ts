import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormAvailability } from '@line-crm/shared';
import FormReception from '../../../liff/src/components/FormReception.js';
import '../../../liff/src/embedded.css';
export function renderFormReception(availability?: FormAvailability): string {
  return renderToStaticMarkup(createElement(FormReception, { availability }));
}
