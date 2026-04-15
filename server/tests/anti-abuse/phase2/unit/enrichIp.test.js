const { enrichIp, isDatacenterOrg } = require('../../../../src/services/ip/enrichIp');

describe('isDatacenterOrg', () => {
  test.each([
    ['Amazon Technologies Inc.', true],
    ['DigitalOcean, LLC', true],
    ['Aliyun Computing Co.', true],
    ['China Telecom', false],
    ['Comcast Cable Communications', false],
    ['', false],
    [null, false],
  ])('isDatacenterOrg(%p) → %p', (org, expected) => {
    expect(isDatacenterOrg(org)).toBe(expected);
  });
});

describe('enrichIp', () => {
  test('unknown → is_datacenter=false', async () => {
    const r = await enrichIp('unknown');
    expect(r.is_datacenter).toBe(false);
  });

  test('ip-api success + hosting=true → is_datacenter=true', async () => {
    const r = await enrichIp('1.2.3.4', {
      fetcher: async () => ({
        status: 'success',
        countryCode: 'US',
        as: 'AS14061 DigitalOcean, LLC',
        asname: 'DIGITALOCEAN-ASN',
        isp: 'DigitalOcean',
        org: 'DigitalOcean',
        hosting: true,
        proxy: false,
      }),
    });
    expect(r.is_datacenter).toBe(true);
    expect(r.asn).toBe(14061);
    expect(r.country).toBe('US');
    expect(r.asn_org).toBe('DIGITALOCEAN-ASN');
  });

  test('普通家宽 ISP → is_datacenter=false', async () => {
    const r = await enrichIp('1.2.3.4', {
      fetcher: async () => ({
        status: 'success',
        countryCode: 'CN',
        as: 'AS4134 Chinanet',
        asname: 'CHINANET-BACKBONE',
        isp: 'China Telecom',
        org: 'China Telecom',
        hosting: false,
        proxy: false,
      }),
    });
    expect(r.is_datacenter).toBe(false);
    expect(r.asn).toBe(4134);
    expect(r.country).toBe('CN');
  });

  test('ip-api fail → is_datacenter=false（fail-open）', async () => {
    const r = await enrichIp('1.2.3.4', {
      fetcher: async () => ({ status: 'fail', message: 'reserved range' }),
    });
    expect(r.is_datacenter).toBe(false);
  });

  test('fetcher 抛异常 → is_datacenter=false', async () => {
    const r = await enrichIp('1.2.3.4', {
      fetcher: async () => { throw new Error('network'); },
    });
    expect(r.is_datacenter).toBe(false);
  });

  test('关键词兜底（hosting=false 但 org 含 amazon）', async () => {
    const r = await enrichIp('1.2.3.4', {
      fetcher: async () => ({
        status: 'success',
        as: 'AS16509 AMAZON-02',
        asname: 'AMAZON-02',
        org: 'Amazon Technologies Inc.',
        hosting: false,
        proxy: false,
      }),
    });
    expect(r.is_datacenter).toBe(true);
  });
});
