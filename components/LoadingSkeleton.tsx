import React from 'react';

export const AnimeCardSkeleton = () => (
  <div className="group relative block w-full animate-pulse">
    <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-[#2a2c31]">
      <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-800" />
    </div>
    <div className="mt-2.5 space-y-2">
      <div className="h-4 bg-gray-700 rounded w-3/4" />
      <div className="h-3 bg-gray-800 rounded w-1/2" />
    </div>
  </div>
);

export const HeroSkeleton = () => (
  <div className="relative h-[60vh] md:h-[65vh] w-full overflow-hidden bg-[#151619] animate-pulse">
    <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900" />
    <div className="absolute inset-0 flex items-center">
      <div className="w-full max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl space-y-4">
          <div className="h-8 bg-gray-700 rounded w-1/4" />
          <div className="h-16 bg-gray-600 rounded w-3/4" />
          <div className="h-4 bg-gray-700 rounded w-full" />
          <div className="h-4 bg-gray-700 rounded w-5/6" />
          <div className="flex gap-4 mt-6">
            <div className="h-12 bg-gray-600 rounded-full w-32" />
            <div className="h-12 bg-gray-700 rounded-full w-32" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const DetailsSkeleton = () => (
  <div className="min-h-screen pb-24 md:pb-20 bg-[#202125] animate-pulse">
    <div className="h-[400px] w-full bg-gradient-to-br from-gray-800 to-gray-900" />
    <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 -mt-60 relative z-10">
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-48 sm:w-56 md:w-72 flex-shrink-0 mx-auto md:mx-0">
          <div className="rounded-xl overflow-hidden bg-gray-700 aspect-[2/3]" />
        </div>
        <div className="flex-1 pt-4 md:pt-16 space-y-4">
          <div className="h-12 bg-gray-700 rounded w-2/3" />
          <div className="h-6 bg-gray-800 rounded w-1/2" />
          <div className="h-4 bg-gray-800 rounded w-full" />
          <div className="h-4 bg-gray-800 rounded w-5/6" />
          <div className="flex gap-4 mt-6">
            <div className="h-12 bg-gray-600 rounded-full w-32" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const EpisodeListSkeleton = () => (
  <div className="grid grid-cols-4 gap-2">
    {Array.from({ length: 12 }).map((_, i) => (
      <div key={i} className="h-10 bg-gray-700 rounded-md animate-pulse" />
    ))}
  </div>
);
