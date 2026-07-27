/**
 * Provider-agnostic card tokenization helper — runs in the browser only.
 *
 * Why this exists: PSPs like Zoop require card tokenization to happen
 * client-side, never from a merchant's backend, so card data never touches
 * infra that isn't PCI-DSS certified (see docs.zoop.co/docs/coletando-dados-de-cartao
 * and docs.zoop.co/docs/autorizacao-direta-de-transacoes for what happens
 * without this — a backend-tokenization block for KYC-approved accounts).
 *
 * The merchant-facing call — tokenizeCard(config) — never changes when we
 * add support for another processor. Only `config.provider` (or a per-store
 * default we control) picks which adapter runs; everything else about the
 * integration stays the same.
 *
 * Usage:
 *   const { tokenId } = await tokenizeCard({
 *     provider: 'zoop', // optional, defaults to 'zoop'
 *     marketplaceId: 'xxxxx',
 *     publishableKey: 'pk_xxx', // safe to expose in browser code
 *     card: { ... }, // TODO (zoop): confirm exact field names against
 *                    // https://docs.zoop.co/reference/post_v1-marketplaces-marketplace-id-cards-tokens-1
 *                    // (number, holder name, exp month/year, cvv). Not
 *                    // guessed here on purpose — verify before shipping.
 *   });
 *   // Send only `tokenId` to your backend. Never send raw card fields there.
 */

const TOKENIZE_ADAPTERS = {
  zoop: async ({ marketplaceId, publishableKey, card }) => {
    const res = await fetch(
      `https://api.zoop.ws/v1/marketplaces/${marketplaceId}/cards/tokens`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Basic Auth with the PUBLISHABLE key only. Never put a private
          // API key here — this code runs in the customer's browser.
          Authorization: `Basic ${btoa(`${publishableKey}:`)}`,
        },
        body: JSON.stringify(card),
      },
    );

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Zoop tokenization failed (${res.status}): ${errorBody}`);
    }

    const data = await res.json();
    // Token expires in 1h (Zoop docs) — use it immediately in the charge
    // call, don't store it for later.
    return { tokenId: data.id, raw: data };
  },

  // Add future processors here (e.g. `newPsp: async (config) => {...}`).
  // Merchant integration code calling tokenizeCard(config) never has to
  // change for this to take effect.
};

async function tokenizeCard(config) {
  const provider = config.provider ?? 'zoop';
  const adapter = TOKENIZE_ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`No tokenization adapter registered for provider "${provider}"`);
  }
  return adapter(config);
}
