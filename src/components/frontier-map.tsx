"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MapboxMap, { AttributionControl, Marker, NavigationControl, type MapRef } from "react-map-gl/mapbox";
import { fieldColors } from "@/lib/problems";
import type { OpenProblem } from "@/lib/types";

interface FrontierMapProps {
  problems: OpenProblem[];
  selectedId?: string;
  onSelect: (problem: OpenProblem) => void;
  onCluster: (problems: OpenProblem[]) => void;
}

export function FrontierMap({ problems, selectedId, onSelect, onCluster }: FrontierMapProps) {
  const mapRef = useRef<MapRef>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const interacting = useRef(false);
  const resumeTimer = useRef<number | undefined>(undefined);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [visibleProblemIds, setVisibleProblemIds] = useState(() => new Set(problems.slice(0, 12).map((problem) => problem.id)));
  const markerOffsets = useMemo(() => {
    const groups = new Map<string, OpenProblem[]>();
    problems.forEach((problem) => {
      const key = `${Math.round(problem.location.longitude / 8)}:${Math.round(problem.location.latitude / 5)}`;
      groups.set(key, [...(groups.get(key) || []), problem]);
    });

    const offsets = new Map<string, [number, number]>();
    groups.forEach((group) => {
      if (group.length === 1) {
        offsets.set(group[0].id, [0, 0]);
        return;
      }
      const columns = Math.ceil(Math.sqrt(group.length));
      const rows = Math.ceil(group.length / columns);
      group.forEach((problem, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        offsets.set(problem.id, [
          (column - (columns - 1) / 2) * 46,
          (row - (rows - 1) / 2) * 46,
        ]);
      });
    });
    return offsets;
  }, [problems]);

  useEffect(() => {
    const problem = problems.find((item) => item.id === selectedId);
    if (problem && mapRef.current) {
      const camera = { center: [problem.location.longitude, problem.location.latitude] as [number, number], zoom: 3.7 };
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) mapRef.current.jumpTo(camera);
      else mapRef.current.flyTo({ ...camera, duration: 1200 });
    }
  }, [problems, selectedId]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previous = performance.now();
    const rotate = () => {
      const now = performance.now();
      const map = mapRef.current;
      if (
        map &&
        !document.hidden &&
        !reducedMotion.matches &&
        !interacting.current &&
        !selectedId &&
        map.getZoom() < 2.8
      ) {
        const elapsed = Math.min(now - previous, 120);
        const center = map.getCenter();
        map.jumpTo({ center: [center.lng - (elapsed / 1000) * 1.2, center.lat] });
      }
      previous = now;
    };
    const rotationTimer = window.setInterval(rotate, 80);
    return () => {
      window.clearInterval(rotationTimer);
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    };
  }, [selectedId]);

  useEffect(() => {
    const updateVisibleMarkers = () => {
      const map = mapRef.current;
      if (!map) return;
      const center = map.getCenter();
      const centerLatitude = center.lat * Math.PI / 180;
      const ids = new Set(problems.flatMap((problem) => {
        const latitude = problem.location.latitude * Math.PI / 180;
        const longitudeDelta = (problem.location.longitude - center.lng) * Math.PI / 180;
        const facing = Math.sin(centerLatitude) * Math.sin(latitude) +
          Math.cos(centerLatitude) * Math.cos(latitude) * Math.cos(longitudeDelta);
        const point = map.project([problem.location.longitude, problem.location.latitude]);
        const container = map.getContainer();
        return facing > 0.06 && point.x > 0 && point.y > 0 && point.x < container.clientWidth && point.y < container.clientHeight
          ? [problem.id]
          : [];
      }));
      setVisibleProblemIds((current) => {
        if (current.size === ids.size && [...current].every((id) => ids.has(id))) return current;
        return ids;
      });
    };
    updateVisibleMarkers();
    const visibilityTimer = window.setInterval(updateVisibleMarkers, 400);
    return () => window.clearInterval(visibilityTimer);
  }, [problems]);

  const pauseRotation = () => {
    interacting.current = true;
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
  };

  const resumeRotation = () => {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => { interacting.current = false; }, 2800);
  };

  const openMarker = (problem: OpenProblem, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      onSelect(problem);
      return;
    }
    const selectedMarker = markerRefs.current.get(problem.id);
    if (!selectedMarker) {
      onSelect(problem);
      return;
    }
    const selectedRect = selectedMarker.getBoundingClientRect();
    const selectedCenter = { x: selectedRect.left + selectedRect.width / 2, y: selectedRect.top + selectedRect.height / 2 };
    const nearby = problems.filter((candidate) => {
      if (!visibleProblemIds.has(candidate.id)) return false;
      const marker = markerRefs.current.get(candidate.id);
      if (!marker) return false;
      const rect = marker.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return Math.hypot(center.x - selectedCenter.x, center.y - selectedCenter.y) < 50;
    });
    if (nearby.length > 1) {
      onCluster(nearby);
      return;
    }
    onSelect(problem);
  };

  if (!token) {
    return (
      <div className="map-fallback" aria-label="Conceptual map of open problems">
        <div className="fallback-grid" />
        {problems.slice(0, 12).map((problem, index) => (
          <button
            className="fallback-point"
            key={problem.id}
            onClick={() => onSelect(problem)}
            style={{
              left: `${10 + ((index * 29) % 80)}%`,
              top: `${14 + ((index * 17) % 70)}%`,
              "--fallback-color": fieldColors[problem.field],
            } as React.CSSProperties}
            title={problem.title}
            aria-label={`Open ${problem.title}`}
          ><span /></button>
        ))}
        <span className="map-token-note">Add NEXT_PUBLIC_MAPBOX_TOKEN for the live atlas</span>
      </div>
    );
  }

  return (
    <MapboxMap
      ref={mapRef}
      mapboxAccessToken={token}
      initialViewState={{ longitude: 8, latitude: 18, zoom: 1.78 }}
      minZoom={1.05}
      maxZoom={8}
      mapStyle="mapbox://styles/mapbox/satellite-v9"
      projection={{ name: "globe" }}
      attributionControl={false}
      reuseMaps
      onLoad={() => {
        mapRef.current?.getMap().setFog({
          color: "rgb(7, 11, 16)",
          "high-color": "rgb(20, 35, 48)",
          "horizon-blend": 0.08,
          "space-color": "rgb(2, 4, 7)",
          "star-intensity": 0.24,
        });
      }}
      onDragStart={pauseRotation}
      onZoomStart={pauseRotation}
      onRotateStart={pauseRotation}
      onDragEnd={resumeRotation}
      onZoomEnd={resumeRotation}
      onRotateEnd={resumeRotation}
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      <AttributionControl position="bottom-left" compact />
      {problems.map((problem) => {
        const selected = problem.id === selectedId;
        return (
          <Marker
            ref={(marker) => {
              if (!marker) return;
              const element = marker.getElement();
              element.removeAttribute("aria-hidden");
              element.removeAttribute("aria-label");
              element.removeAttribute("role");
              element.tabIndex = -1;
            }}
            key={problem.id}
            longitude={problem.location.longitude}
            latitude={problem.location.latitude}
            anchor="center"
            offset={markerOffsets.get(problem.id)}
          >
            <button
              ref={(element) => {
                if (element) markerRefs.current.set(problem.id, element);
                else markerRefs.current.delete(problem.id);
              }}
              className={`problem-marker ${selected ? "is-selected" : ""}`}
              style={{ "--marker-color": fieldColors[problem.field] } as React.CSSProperties}
              onPointerEnter={pauseRotation}
              onPointerLeave={resumeRotation}
              onPointerDown={pauseRotation}
              onFocus={pauseRotation}
              onBlur={resumeRotation}
              tabIndex={visibleProblemIds.has(problem.id) ? 0 : -1}
              onClick={(event) => {
                event.stopPropagation();
                openMarker(problem, event);
              }}
              aria-label={`Open ${problem.title}`}
            >
              <span />
              <em>{problem.title}</em>
            </button>
          </Marker>
        );
      })}
    </MapboxMap>
  );
}
