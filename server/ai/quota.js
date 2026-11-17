import { createHash } from 'node:crypto';

const minuteBuckets = new Map();
const dailyBuckets = new Map();
const minuteMs = 60_000;

export async function reserveAiQuota({ uid, ip, db, now = Date.now() }) {
  const day = new Date(now).toISOString().slice(0, 10);
  const minuteUser = uid ? `user:${uid}` : '';
  const minuteIp = `ip:${ip || 'unknown'}`;
  if (!consumeWindow(minuteUser, 5, now) || !consumeWindow(minuteIp, 10, now)) {
    return false;
  }

  const dailyUserKey = uid ? `user:${uid}:${day}` : '';
  const dailyIpKey = `ip:${ip || 'unknown'}:${day}`;
  if (!consumeDaily(dailyUserKey, 20, day) || !consumeDaily(dailyIpKey, 40, day)) {
    return false;
  }
  if (!db) return true;

  const userDoc = dailyUserKey ? db.collection('aiUsage').doc(hash(dailyUserKey)) : null;
  const ipDoc = db.collection('aiUsage').doc(hash(dailyIpKey));
  return db.runTransaction(async transaction => {
    const [userSnapshot, ipSnapshot] = await Promise.all([
      userDoc ? transaction.get(userDoc) : Promise.resolve(null),
      transaction.get(ipDoc)
    ]);
    const userCount = userSnapshot?.get('count') || 0;
    const ipCount = ipSnapshot.get('count') || 0;
    if ((userDoc && userCount >= 20) || ipCount >= 40) return false;
    const expiresAt = new Date(`${day}T23:59:59.999Z`);
    if (userDoc) transaction.set(userDoc, { count: userCount + 1, expiresAt });
    transaction.set(ipDoc, { count: ipCount + 1, expiresAt });
    return true;
  });
}

function consumeWindow(key, limit, now) {
  if (!key) return true;
  const active = (minuteBuckets.get(key) || []).filter(timestamp => timestamp > now - minuteMs);
  if (active.length >= limit) return false;
  active.push(now);
  minuteBuckets.set(key, active);
  if (minuteBuckets.size > 10_000) {
    for (const [bucket, timestamps] of minuteBuckets) {
      if (!timestamps.some(timestamp => timestamp > now - minuteMs)) minuteBuckets.delete(bucket);
    }
  }
  return true;
}

function consumeDaily(key, limit, day) {
  if (!key) return true;
  const bucket = dailyBuckets.get(key);
  if (bucket?.day === day && bucket.count >= limit) return false;
  dailyBuckets.set(key, { day, count: bucket?.day === day ? bucket.count + 1 : 1 });
  if (dailyBuckets.size > 20_000) {
    for (const [entry, value] of dailyBuckets) {
      if (value.day !== day) dailyBuckets.delete(entry);
    }
  }
  return true;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
