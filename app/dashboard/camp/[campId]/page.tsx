export default function CampDetailPage({ params }: { params: { campId: string } }) {
  return (
    <div className="p-6 text-stone-500">
      <h1 className="text-xl font-semibold text-stone-700 mb-2">Camp Detail</h1>
      <p className="text-sm">Camp ID: {params.campId}</p>
      <p className="text-sm">Not yet implemented. CampDetailPanel goes here.</p>
    </div>
  );
}
