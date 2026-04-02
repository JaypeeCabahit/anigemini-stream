import React, { useState, useEffect, useRef } from 'react';

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  placeholder?: string;
  threshold?: number;
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"%3E%3Crect fill="%232a2c31" width="400" height="600"/%3E%3C/svg%3E',
  threshold = 0.1,
  className = '',
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState(placeholder);
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!imgRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setImageSrc(src);
            observer.disconnect();
          }
        });
      },
      { threshold, rootMargin: '50px' }
    );

    observer.observe(imgRef.current);

    return () => observer.disconnect();
  }, [src, threshold]);

  return (
    <img
      ref={imgRef}
      src={imageSrc}
      alt={alt}
      onLoad={() => setIsLoaded(true)}
      className={`transition-opacity duration-300 ${
        isLoaded ? 'opacity-100' : 'opacity-0'
      } ${className}`}
      {...props}
    />
  );
};

// Progressive image component with blur-up effect
interface ProgressiveImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  lowResSrc?: string;
}

export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  alt,
  lowResSrc,
  className = '',
  ...props
}) => {
  const [currentSrc, setCurrentSrc] = useState(lowResSrc || src);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const img = new Image();
    img.src = src;

    img.onload = () => {
      setCurrentSrc(src);
      setIsLoading(false);
    };

    return () => {
      img.onload = null;
    };
  }, [src]);

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={`transition-all duration-500 ${
        isLoading && lowResSrc ? 'blur-sm scale-105' : 'blur-0 scale-100'
      } ${className}`}
      {...props}
    />
  );
};
