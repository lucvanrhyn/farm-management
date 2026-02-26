export default function CampInspectionPage({ params }: { params: { campId: string } }) {
  return (
    <div className="p-6 text-stone-500">
      <h1 className="text-xl font-semibold text-stone-700 mb-2">Logger — Camp Inspection</h1>
      <p className="text-sm">Camp ID: {params.campId}</p>
      <p className="text-sm">Not yet implemented. AnimalChecklist and exception forms go here.</p>
    </div>
  );
}
