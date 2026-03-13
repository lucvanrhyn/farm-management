export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-green-950 flex flex-col items-center justify-center text-white p-8 text-center">
      <div className="mb-6 text-6xl">📡</div>
      <h1 className="text-2xl font-bold mb-4">Geen verbinding</h1>
      <p className="text-green-300 mb-8 max-w-sm">
        Jy is tans vanlyn. Gaan terug na die logger om kampe aan te meld — dit
        werk sonder internet.
      </p>
      <a
        href="/logger"
        className="bg-green-700 hover:bg-green-600 active:bg-green-800 text-white px-6 py-3 rounded-lg font-medium transition-colors"
      >
        Terug na Logger
      </a>
    </div>
  );
}
