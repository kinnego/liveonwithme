import { CSSProperties } from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) {
  return (
    <span
      className="sk"
      aria-hidden="true"
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
        ...style,
      }}
    />
  );
}

type Variant = 'default' | 'form' | 'detail' | 'hero' | 'compact';

interface PageSkeletonProps {
  variant?: Variant;
  label?: string;
}

export function PageSkeleton({ variant = 'default', label = 'Loading' }: PageSkeletonProps) {
  return (
    <main className="shell" role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only" style={srOnly}>
        {label}
      </span>
      {variant === 'compact' ? (
        <CompactBody />
      ) : variant === 'hero' ? (
        <HeroBody />
      ) : variant === 'form' ? (
        <FormBody />
      ) : variant === 'detail' ? (
        <DetailBody />
      ) : (
        <DefaultBody />
      )}
    </main>
  );
}

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function DefaultBody() {
  return (
    <div className="skStack" style={{ gap: 24 }}>
      <div className="skStack" style={{ gap: 12 }}>
        <Skeleton width={110} height={12} />
        <Skeleton width="55%" height={36} />
        <Skeleton width="40%" height={14} />
      </div>
      <CardShape />
    </div>
  );
}

function DetailBody() {
  return (
    <div className="skStack" style={{ gap: 24 }}>
      <div className="skStack" style={{ gap: 12 }}>
        <Skeleton width={110} height={12} />
        <Skeleton width="45%" height={40} />
        <div className="skRow">
          <Skeleton width={90} height={22} radius={999} />
          <Skeleton width={140} height={14} />
        </div>
      </div>
      <CardShape lines={4} />
      <CardShape lines={2} />
    </div>
  );
}

function FormBody() {
  return (
    <div className="formCard skStack" style={{ gap: 18 }}>
      <Skeleton width={110} height={12} />
      <Skeleton width="60%" height={30} />
      <Skeleton width="90%" height={14} />
      <div className="skStack" style={{ gap: 12, marginTop: 12 }}>
        <div className="skStack" style={{ gap: 6 }}>
          <Skeleton width={80} height={12} />
          <Skeleton height={44} radius={12} />
        </div>
        <div className="skStack" style={{ gap: 6 }}>
          <Skeleton width={80} height={12} />
          <Skeleton height={44} radius={12} />
        </div>
      </div>
      <Skeleton width="100%" height={48} radius={999} style={{ marginTop: 12 }} />
    </div>
  );
}

function HeroBody() {
  return (
    <div className="skStack" style={{ gap: 30 }}>
      <div
        className="skStack"
        style={{ gap: 14, alignItems: 'center', textAlign: 'center', padding: '40px 0' }}
      >
        <Skeleton width={140} height={140} radius={999} />
        <Skeleton width="45%" height={42} />
        <Skeleton width="30%" height={16} />
      </div>
      <CardShape lines={3} />
    </div>
  );
}

function CompactBody() {
  return (
    <div className="skStack" style={{ gap: 12, maxWidth: 420 }}>
      <Skeleton width="70%" height={18} />
      <Skeleton width="45%" height={14} />
    </div>
  );
}

function CardShape({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card skStack" style={{ gap: 14 }}>
      <Skeleton width="40%" height={20} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} height={12} />
      ))}
    </div>
  );
}
