/**
 * Wave G3 (#167) — shared GeoJSON types for the map domain ops.
 *
 * Local minimal aliases so the map domain doesn't depend on
 * `@types/geojson`. Each Feature's `properties` shape is per-op and
 * declared at the call-site (see `list-*.ts`).
 */

export interface GeoJsonPoint {
  readonly type: "Point";
  readonly coordinates: readonly [number, number];
}

export interface GeoJsonFeature<TProps> {
  readonly type: "Feature";
  readonly geometry: GeoJsonPoint;
  readonly properties: TProps;
}

export interface GeoJsonFeatureCollection<TProps = Record<string, unknown>> {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<GeoJsonFeature<TProps>>;
}
