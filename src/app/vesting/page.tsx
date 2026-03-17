'use client';
import Link from 'next/link';
import styles from './vesting.module.css';

const MOCK_SCHEDULES = [
  {
    id: '0',
    beneficiary: 'GBOB123456789012345678901234567890123456789012345678WXYZ',
    totalAmount: 120_000_000_000n,
    cliffTime: 1740787200,
    endTime:   1767225600,
    claimed:   0n,
    revoked:   false,
  },
];

function fmt(stroops: bigint) {
  return (Number(stroops) / 1e7).toLocaleString();
}

function pct(schedule: typeof MOCK_SCHEDULES[0]): number {
  const now = Math.floor(Date.now() / 1000);
  if (now < schedule.cliffTime) return 0;
  if (now >= schedule.endTime)  return 100;
  const elapsed  = now - schedule.cliffTime;
  const duration = schedule.endTime - schedule.cliffTime;
  return Math.round((elapsed / duration) * 100);
}

export default function Vesting() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Vesting Schedules</h1>
        <Link href="/vesting/create" className={styles.newBtn}>
          + New Schedule
        </Link>
      </div>

      <div className={styles.list}>
        {MOCK_SCHEDULES.map(s => (
          <div key={s.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.schedId}>Schedule #{s.id}</span>
              <span className={styles.badge}>{s.revoked ? 'Revoked' : 'Active'}</span>
            </div>

            <div className={styles.row}>
              <span>Beneficiary</span>
              <span>{s.beneficiary.slice(0,5)}...{s.beneficiary.slice(-4)}</span>
            </div>
            <div className={styles.row}>
              <span>Total</span>
              <span>{fmt(s.totalAmount)} XLM</span>
            </div>
            <div className={styles.row}>
              <span>Claimed</span>
              <span>{fmt(s.claimed)} XLM</span>
            </div>

            <div className={styles.bar}>
              <div className={styles.fill} style={{ width: `${pct(s)}%` }} />
            </div>
            <p className={styles.pctLabel}>{pct(s)}% vested</p>
          </div>
        ))}
      </div>
    </div>
  );
}
