import { Skeleton } from '../../components/Skeleton';

/** Placeholder in the shape of the result layout, so nothing jumps when the card arrives. */
export function CardSkeleton({ label }: { label: string }) {
  return (
    <div className="screen-pad card-body" aria-busy="true">
      <div className="card-hero">
        <div className="card-art">
          <Skeleton shape="card" />
        </div>
      </div>
      <div className="card-head">
        <Skeleton width="56%" height={32} />
        <Skeleton width="34%" height={18} />
        <div className="row">
          <Skeleton width={150} height={30} />
          <Skeleton width={84} height={30} />
        </div>
      </div>
      <div className="surface card-price center">
        <Skeleton width={150} height={42} className="card-skel-pill" />
        <Skeleton width={70} height={15} />
        <Skeleton width="52%" height={52} />
        <Skeleton height={10} className="card-skel-pill" />
      </div>
      <p className="small muted center" role="status">
        {label}
      </p>
    </div>
  );
}
