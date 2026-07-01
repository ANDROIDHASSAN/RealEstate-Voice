import { envVal, forceMock, type ProviderInfo } from './base.js';

/**
 * Stripe over REST. With no key, billing runs in mock mode: plan changes are
 * applied directly and clearly labeled — module gating logic is identical.
 */
export class StripeClient {
  private get key() {
    return envVal('STRIPE_SECRET_KEY');
  }

  get info(): ProviderInfo {
    return {
      name: 'Stripe',
      live: !forceMock() && Boolean(this.key),
      reason: forceMock() ? 'forced mock (tests)' : this.key ? undefined : 'STRIPE_SECRET_KEY missing',
    };
  }

  private async post(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data as { error?: { message?: string } }).error;
      throw new Error(err?.message ?? `Stripe HTTP ${res.status}`);
    }
    return data;
  }

  async createCustomer(email: string, name: string): Promise<string> {
    const c = await this.post('customers', { email, name });
    return c.id as string;
  }

  async createCheckoutSession(opts: {
    customerId: string;
    priceMonthlyUsd: number;
    planKey: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; id: string }> {
    const s = await this.post('checkout/sessions', {
      customer: opts.customerId,
      mode: 'subscription',
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(opts.priceMonthlyUsd * 100),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': `CloseFlow ${opts.planKey}`,
      'metadata[plan]': opts.planKey,
      'subscription_data[metadata][plan]': opts.planKey,
    });
    return { url: s.url as string, id: s.id as string };
  }
}

export const stripe = new StripeClient();
