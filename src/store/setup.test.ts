import { beforeEach, describe, expect, it } from 'vitest';

import { SAMPLE_CATALOGS, type CatalogItem } from '@/lib/catalogs';
import { checklistItems } from '@/lib/checklist';
import { qty } from '@/lib/qty';
import { DEFAULT_SETTINGS } from '@/lib/seed';
import { usePos, type SetupInput } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { ownerShop, resetStore } from '@/test/store';

const S = () => usePos.getState();

const INPUT: SetupInput = {
  shopType: 'auto',
  businessName: 'Sampalok Auto Shop',
  ownerName: 'Nena',
  pin: '481902',
  recoveryCode: 'ABCD-EFGH-JKLM',
  catalog: 'sample',
};

/** Run the wizard, then sign the owner in the way it does. */
async function setup(over: Partial<SetupInput> = {}) {
  const result = await S().setupInstall({ ...INPUT, ...over });
  if (!result.ok) throw new Error(result.error);
  const owner = S().users[0]!;
  useAuth.setState({
    session: { userId: owner.id, name: owner.name, role: owner.role, signedInAt: Date.now() },
  });
}

function item(name: string, from: CatalogItem[] = SAMPLE_CATALOGS.auto): CatalogItem {
  const found = from.find((i) => i.name === name);
  if (!found) throw new Error(`no sample item called ${name}`);
  return found;
}

describe('first-run setup', () => {
  beforeEach(resetStore);

  it('turns on the switches the chosen shop type needs', async () => {
    await setup();
    expect(S().settings.shopType).toBe('auto');
    expect(S().settings.features.vehiclePlate).toBe(true);
  });

  it('names the business and its owner', async () => {
    await setup();
    expect(S().settings.businessName).toBe('Sampalok Auto Shop');
    const [owner] = S().users;
    expect(owner?.name).toBe('Nena');
    expect(owner?.role).toBe('superadmin');
  });

  it('starts in practice mode, so nothing is filed until the owner says so', async () => {
    await setup();
    expect(S().settings.trainingMode).toBe(true);
  });

  it('loads the sample catalog for that shop type, services and all', async () => {
    await setup();
    expect(S().products).toHaveLength(SAMPLE_CATALOGS.auto.length);
    expect(S().products.find((p) => p.name === 'Wheel Alignment')?.kind).toBe('service');
  });

  it('carries the catalog prices and costs onto the products', async () => {
    await setup();
    const tire = item('Tire 185/65 R14');
    const product = S().products.find((p) => p.name === tire.name);
    expect(product?.priceCents).toBe(tire.priceCents);
    expect(product?.costCents).toBe(tire.costCents);
  });

  it('puts every stocked item on the shelf at its opening quantity', async () => {
    await setup();
    for (const line of SAMPLE_CATALOGS.auto.filter((i) => i.kind === 'stock')) {
      const product = S().products.find((p) => p.name === line.name);
      if (!product) throw new Error(`no product called ${line.name}`);
      expect(S().stockOf(product.id)).toBe(line.openingQty);
    }
  });

  it('books that opening stock as opening moves, one per stocked item', async () => {
    await setup();
    const stocked = SAMPLE_CATALOGS.auto.filter((i) => i.kind === 'stock');
    const opening = S().stockMoves.filter((m) => m.reason === 'opening');
    expect(opening).toHaveLength(stocked.length);
    for (const move of opening) {
      expect(move.delta).toBe(item(S().product(move.productId)!.name, stocked).openingQty);
    }
  });

  it('never stocks a service', async () => {
    await setup();
    for (const product of S().products.filter((p) => p.kind === 'service')) {
      expect(S().stockOf(product.id)).toBe(qty(0));
    }
  });

  it('starts an empty shop when the owner turns the sample down', async () => {
    await setup({ catalog: 'none' });
    expect(S().products).toEqual([]);
    expect(S().stockMoves).toEqual([]);
  });

  it('refuses a shop with no name, an owner with no name, and a short PIN', async () => {
    expect((await S().setupInstall({ ...INPUT, businessName: '  ' })).ok).toBe(false);
    expect((await S().setupInstall({ ...INPUT, ownerName: ' ' })).ok).toBe(false);
    expect((await S().setupInstall({ ...INPUT, pin: '1234' })).ok).toBe(false);
    expect(S().users).toEqual([]);
    expect(S().products).toEqual([]);
  });

  it('cannot run twice', async () => {
    await setup();
    expect((await S().setupInstall(INPUT)).ok).toBe(false);
    expect(S().users).toHaveLength(1);
  });

  it('leaves the address and the VAT question to the owner, not the wizard', async () => {
    await setup();
    expect(S().settings.address).toBe('');
    expect(S().settings.vatRegistered).toBe(false);
  });

  it('offers a catalog for every shop type', () => {
    for (const [shopType, lines] of Object.entries(SAMPLE_CATALOGS)) {
      expect(lines.length, shopType).toBeGreaterThanOrEqual(10);
      expect(lines.length, shopType).toBeLessThanOrEqual(15);
    }
    // The measured shops sell by the metre and the kilogram.
    const units = SAMPLE_CATALOGS.retail.map((i) => i.unit);
    expect(units).toContain('m');
    expect(units).toContain('kg');
    expect(SAMPLE_CATALOGS.auto.some((i) => i.kind === 'service' && i.unit === 'hr')).toBe(true);
  });
});

describe('the finish-setting-up checklist', () => {
  beforeEach(resetStore);

  it('lists every unfinished job, in the order the owner meets them', async () => {
    await setup();
    expect(checklistItems(S()).map((i) => i.id)).toEqual([
      'printer',
      'address',
      'vat',
      'license',
      'staff',
    ]);
  });

  it('counts the license as outstanding until one is installed', async () => {
    await setup();
    expect(checklistItems(S()).find((i) => i.id === 'license')?.done).toBe(false);
  });

  it('marks the address done once the owner gives one', async () => {
    await setup();
    expect(checklistItems(S()).find((i) => i.id === 'address')?.done).toBe(false);
    S().updateSettings({ address: '123 Mabini St' });
    expect(checklistItems(S()).find((i) => i.id === 'address')?.done).toBe(true);
  });

  it('takes the VAT question once the owner dismisses it', async () => {
    await setup();
    S().updateSettings({ checklistDismissed: ['vat'] });
    expect(checklistItems(S()).find((i) => i.id === 'vat')?.done).toBe(true);
  });

  it('retires a job dismissed on any of them, not just the VAT question', async () => {
    await setup();
    S().updateSettings({ checklistDismissed: ['printer', 'address', 'license', 'staff'] });
    for (const id of ['printer', 'address', 'license', 'staff'] as const) {
      expect(checklistItems(S()).find((i) => i.id === id)?.done).toBe(true);
    }
  });

  it('hides the card once every job is done or retired', async () => {
    await setup();
    S().updateSettings({
      address: '123 Mabini St',
      checklistDismissed: ['printer', 'vat', 'license', 'staff'],
    });
    expect(checklistItems(S()).some((i) => !i.done)).toBe(false);
  });

  it('calls the printer done once one is paired', async () => {
    await setup();
    S().updateSettings({
      printer: { name: 'Epson TM-T82', address: '00:11:22:33:44:55', width: 80 },
    });
    expect(checklistItems(S()).find((i) => i.id === 'printer')?.done).toBe(true);
  });

  it('still wants staff while the owner is the only account', async () => {
    await setup();
    expect(checklistItems(S()).find((i) => i.id === 'staff')?.done).toBe(false);
    const second = await S().addUser({ name: 'Rina', role: 'staff', pin: '135791' });
    if (!second.ok) throw new Error(second.error);
    expect(checklistItems(S()).find((i) => i.id === 'staff')?.done).toBe(true);
  });

  it('points every job at the Settings section that does it', () => {
    const hrefs = checklistItems({ settings: DEFAULT_SETTINGS, licensed: null, users: [] }).map(
      (item) => item.href,
    );
    expect(hrefs).toEqual([
      '/settings#receipt-printer',
      '/settings#business',
      '/settings#tax',
      '/settings#license',
      '/settings#users',
    ]);
  });

  it('counts the VAT question answered once the VAT switch is set, either way', async () => {
    resetStore();
    await ownerShop();
    expect(checklistItems(S()).find((i) => i.id === 'vat')?.done).toBe(false);
    S().updateSettings({ vatRegistered: false });
    expect(checklistItems(S()).find((i) => i.id === 'vat')?.done).toBe(true);
  });
});

describe('going live', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
  });

  it('wipes practice data and keeps the shop: products, codes, users, settings', () => {
    const item = S().products.find((p) => p.kind === 'stock')!;
    const id = S().openOrder('T1', 'dine-in');
    S().addLine(id, item.id);
    S().serveAll(id);
    expect(S().payExact(id, 'cash').ok).toBe(true);
    expect(S().createPromo({ code: 'GRAND10', percent: 10 }).ok).toBe(true);
    const products = S().products;

    usePos.setState({ licensed: { licenseId: 'LIC-TEST' } as never });
    S().updateSettings({ trainingMode: false });

    expect(S().settings.trainingMode).toBe(false);
    expect(S().orders).toEqual([]);
    expect(S().stockMoves).toEqual([]);
    expect(S().closes).toEqual([]);
    expect(S().quotes).toEqual([]);
    expect(S().stock[S().activeBranchId]?.[item.id] ?? 0).toBe(0);
    expect(S().products).toBe(products);
    expect(S().promos.map((p) => p.code)).toEqual(['GRAND10']);
    expect(S().users).toHaveLength(1);
    expect(S().audit.some((a) => a.kind === 'data.reset' && a.message.startsWith('Went live'))).toBe(true);
  });

  it('wipes nothing without a license, because it does not go live', () => {
    const before = S().stockMoves.length;
    S().updateSettings({ trainingMode: false });
    expect(S().settings.trainingMode).toBe(true);
    expect(S().stockMoves).toHaveLength(before);
  });
});
