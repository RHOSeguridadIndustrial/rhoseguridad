// Server-side adapter for the isolated qw10_test prototype ONLY.
// Never points at production inventory or customer orders.
export function paymentTestStore({query}) {
  if (typeof query !== 'function') throw new Error('Database query required');
  return {
    async loadRequest(sessionId) {
      if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId || '')) throw new Error('Test session required');
      const {rows} = await query(
        'select id,session_id,total_cents,livemode from qw10_test.requests where session_id=$1', [sessionId]);
      const row = rows[0];
      if (!row) return undefined;
      const totalCents = Number(row.total_cents);
      if (row.livemode !== false || !Number.isSafeInteger(totalCents) || totalCents <= 0)
        throw new Error('Invalid test request');
      return {id:row.id,sessionId:row.session_id,totalCents,livemode:false};
    },
    async commitPaid(p) {
      if (p.livemode !== false || !/^cs_test_[A-Za-z0-9_]+$/.test(p.sessionId || '') ||
          !Number.isSafeInteger(p.amountCents) || p.amountCents <= 0 || p.currency !== 'mxn')
        throw new Error('Invalid test payment');
      const {rows} = await query(
        'select qw10_test.commit_payment($1,$2,$3,$4,$5,$6,$7) result',
        [p.requestId,p.sessionId,p.paymentIntentId,p.amountCents,p.currency,false,p.eventId]);
      return rows[0].result;
    }
  };
}
