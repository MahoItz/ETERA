export function ProductDetailSkeleton() {
  return <>
    <p className="sr-only" role="status">Загружаем работу…</p>
    <div className="product-detail-loading" aria-busy="true">
      <div className="detail product-detail-skeleton" aria-hidden="true">
        <div className="product-visual">
          <div className="product-gallery-stage product-skeleton-block" />
          <div className="product-skeleton-thumbnails">
            <span className="product-skeleton-block" />
            <span className="product-skeleton-block" />
            <span className="product-skeleton-block" />
          </div>
        </div>
        <div className="product-skeleton-copy">
          <div className="product-skeleton-block product-skeleton-category" />
          <div className="product-skeleton-title">
            <div className="product-skeleton-block" />
            <div className="product-skeleton-block" />
          </div>
          <div className="product-skeleton-block product-skeleton-availability" />
          <div className="product-skeleton-block product-skeleton-price" />
          <div className="product-skeleton-description">
            <div className="product-skeleton-block" />
            <div className="product-skeleton-block" />
            <div className="product-skeleton-block" />
          </div>
          <div className="product-skeleton-block product-skeleton-action" />
          <div className="product-skeleton-block product-skeleton-action" />
        </div>
      </div>
      <div className="product-mobile-action product-skeleton-mobile" aria-hidden="true">
        <span className="product-skeleton-block product-skeleton-price" />
        <span className="product-skeleton-block product-skeleton-action" />
      </div>
    </div>
  </>;
}
