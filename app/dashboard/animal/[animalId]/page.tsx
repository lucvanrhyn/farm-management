export default function AnimalProfilePage({ params }: { params: { animalId: string } }) {
  return (
    <div className="p-6 text-stone-500">
      <h1 className="text-xl font-semibold text-stone-700 mb-2">Animal Profile</h1>
      <p className="text-sm">Animal ID: {params.animalId}</p>
      <p className="text-sm">Not yet implemented. AnimalProfile component goes here.</p>
    </div>
  );
}
