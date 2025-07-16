"use client";

import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import {
  Scissors,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Snowflake,
  Copy,
  SplitSquareHorizontal,
  Pause,
  Play,
  Video,
  Music,
  TypeIcon,
  Lock,
  LockOpen,
  Plus,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "../ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineZoom } from "@/hooks/use-timeline-zoom";
import { processMediaFiles } from "@/lib/media-processing";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { TimelineTrackContent } from "./timeline-track";
import {
  TimelinePlayhead,
  useTimelinePlayheadRuler,
} from "./timeline-playhead";
import { SelectionBox } from "./selection-box";
import { useSelectionBox } from "@/hooks/use-selection-box";
import { SnapIndicator } from "./snap-indicator";
import { SnapPoint } from "@/hooks/use-timeline-snapping";
import type { DragData, TimelineTrack } from "@/types/timeline";
import {
  getTrackHeight,
  getCumulativeHeightBefore,
  getTotalTracksHeight,
  TIMELINE_CONSTANTS,
  snapTimeToFrame,
} from "@/constants/timeline-constants";

export function Timeline() {
  // Timeline shows all tracks (video, audio, effects) and their elements.
  // You can drag media here to add it to your project.
  // elements can be trimmed, deleted, and moved.

  const {
    tracks,
    addTrack,
    addElementToTrack,
    removeElementFromTrack,
    getTotalDuration,
    selectedElements,
    clearSelectedElements,
    setSelectedElements,
    splitElement,
    splitAndKeepLeft,
    splitAndKeepRight,
    toggleTrackMute,
    separateAudio,
    undo,
    redo,
    snappingEnabled,
    toggleSnapping,
    dragState,
  } = useTimelineStore();
  const { mediaItems, addMediaItem } = useMediaStore();
  const { activeProject } = useProjectStore();
  const { currentTime, duration, seek, setDuration, isPlaying, toggle } =
    usePlaybackStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const dragCounterRef = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [isInTimeline, setIsInTimeline] = useState(false);

  // Timeline zoom functionality
  const { zoomLevel, setZoomLevel, handleWheel } = useTimelineZoom({
    containerRef: timelineRef,
    isInTimeline,
  });

  // Old marquee selection removed - using new SelectionBox component instead

  // Dynamic timeline width calculation based on playhead position and duration
  const dynamicTimelineWidth = Math.max(
    (duration || 0) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel, // Base width from duration
    (currentTime + 30) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel, // Width to show current time + 30 seconds buffer
    timelineRef.current?.clientWidth || 1000 // Minimum width
  );

  // Scroll synchronization and auto-scroll to playhead
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const trackLabelsRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const trackLabelsScrollRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);
  const lastRulerSync = useRef(0);
  const lastTracksSync = useRef(0);
  const lastVerticalSync = useRef(0);

  // Timeline playhead ruler handlers
  const { handleRulerMouseDown } = useTimelinePlayheadRuler({
    currentTime,
    duration,
    zoomLevel,
    seek,
    rulerRef,
    rulerScrollRef,
    tracksScrollRef,
    playheadRef,
  });

  // Selection box functionality
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const {
    selectionBox,
    handleMouseDown: handleSelectionMouseDown,
    isSelecting,
    justFinishedSelecting,
  } = useSelectionBox({
    containerRef: tracksContainerRef,
    playheadRef,
    onSelectionComplete: (elements) => {
      console.log(JSON.stringify({ onSelectionComplete: elements.length }));
      setSelectedElements(elements);
    },
  });

  // Calculate snap indicator state
  const [currentSnapPoint, setCurrentSnapPoint] = useState<SnapPoint | null>(
    null
  );
  const showSnapIndicator =
    dragState.isDragging && snappingEnabled && currentSnapPoint !== null;

  // Callback to handle snap point changes from TimelineTrackContent
  const handleSnapPointChange = useCallback((snapPoint: SnapPoint | null) => {
    setCurrentSnapPoint(snapPoint);
  }, []);

  // Timeline content click to seek handler
  const handleTimelineContentClick = useCallback(
    (e: React.MouseEvent) => {
      console.log(
        JSON.stringify({
          timelineClick: {
            isSelecting,
            justFinishedSelecting,
            willReturn: isSelecting || justFinishedSelecting,
          },
        })
      );

      // Don't seek if this was a selection box operation
      if (isSelecting || justFinishedSelecting) {
        return;
      }

      // Don't seek if clicking on timeline elements, but still deselect
      if ((e.target as HTMLElement).closest(".timeline-element")) {
        return;
      }

      // Don't seek if clicking on playhead
      if (playheadRef.current?.contains(e.target as Node)) {
        return;
      }

      // Don't seek if clicking on track labels
      if ((e.target as HTMLElement).closest("[data-track-labels]")) {
        clearSelectedElements();
        return;
      }

      // Clear selected elements when clicking empty timeline area
      console.log(JSON.stringify({ clearingSelectedElements: true }));
      clearSelectedElements();

      // Determine if we're clicking in ruler or tracks area
      const isRulerClick = (e.target as HTMLElement).closest(
        "[data-ruler-area]"
      );

      let mouseX: number;
      let scrollLeft = 0;

      if (isRulerClick) {
        // Calculate based on ruler position
        const rulerContent = rulerScrollRef.current?.querySelector(
          "[data-radix-scroll-area-viewport]"
        ) as HTMLElement;
        if (!rulerContent) return;
        const rect = rulerContent.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        scrollLeft = rulerContent.scrollLeft;
      } else {
        // Calculate based on tracks content position
        const tracksContent = tracksScrollRef.current?.querySelector(
          "[data-radix-scroll-area-viewport]"
        ) as HTMLElement;
        if (!tracksContent) return;
        const rect = tracksContent.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        scrollLeft = tracksContent.scrollLeft;
      }

      const rawTime = Math.max(
        0,
        Math.min(
          duration,
          (mouseX + scrollLeft) /
          (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        )
      );

      // Use frame snapping for timeline clicking
      const projectFps = activeProject?.fps || 30;
      const time = snapTimeToFrame(rawTime, projectFps);

      seek(time);
    },
    [
      duration,
      zoomLevel,
      seek,
      rulerScrollRef,
      tracksScrollRef,
      clearSelectedElements,
      isSelecting,
      justFinishedSelecting,
    ]
  );

  // Update timeline duration when tracks change
  useEffect(() => {
    const totalDuration = getTotalDuration();
    setDuration(Math.max(totalDuration, 10)); // Minimum 10 seconds for empty timeline
  }, [tracks, setDuration, getTotalDuration]);

  // Old marquee system removed - using new SelectionBox component instead

  const handleDragEnter = (e: React.DragEvent) => {
    // When something is dragged over the timeline, show overlay
    e.preventDefault();
    // Don't show overlay for timeline elements - they're handled by tracks
    if (e.dataTransfer.types.includes("application/x-timeline-element")) {
      return;
    }
    dragCounterRef.current += 1;
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();

    // Don't update state for timeline elements - they're handled by tracks
    if (e.dataTransfer.types.includes("application/x-timeline-element")) {
      return;
    }

    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    // When media is dropped, add it as a new track/element
    e.preventDefault();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    // Ignore timeline element drags - they're handled by track-specific handlers
    const hasTimelineElement = e.dataTransfer.types.includes(
      "application/x-timeline-element"
    );
    if (hasTimelineElement) {
      return;
    }

    const itemData = e.dataTransfer.getData("application/x-media-item");
    if (itemData) {
      try {
        const dragData: DragData = JSON.parse(itemData);

        if (dragData.type === "text") {
          // Always create new text track to avoid overlaps
          useTimelineStore.getState().addTextToNewTrack(dragData);
        } else {
          // Handle media items
          const mediaItem = mediaItems.find(
            (item: any) => item.id === dragData.id
          );
          if (!mediaItem) {
            toast.error("Media item not found");
            return;
          }

          useTimelineStore.getState().addMediaToNewTrack(mediaItem);
        }
      } catch (error) {
        console.error("Error parsing dropped item data:", error);
        toast.error("Failed to add item to timeline");
      }
    } else if (e.dataTransfer.files?.length > 0) {
      // Handle file drops by creating new tracks
      if (!activeProject) {
        toast.error("No active project");
        return;
      }

      setIsProcessing(true);
      setProgress(0);
      try {
        const processedItems = await processMediaFiles(
          e.dataTransfer.files,
          (p) => setProgress(p)
        );
        for (const processedItem of processedItems) {
          await addMediaItem(activeProject.id, processedItem);
          const currentMediaItems = useMediaStore.getState().mediaItems;
          const addedItem = currentMediaItems.find(
            (item) =>
              item.name === processedItem.name && item.url === processedItem.url
          );
          if (addedItem) {
            useTimelineStore.getState().addMediaToNewTrack(addedItem);
          }
        }
      } catch (error) {
        // Show error if file processing fails
        console.error("Error processing external files:", error);
        toast.error("Failed to process dropped files");
      } finally {
        setIsProcessing(false);
        setProgress(0);
      }
    }
  };

  const dragProps = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  // Action handlers for toolbar
  const handleSplitSelected = () => {
    if (selectedElements.length === 0) {
      toast.error("No elements selected");
      return;
    }
    let splitCount = 0;
    selectedElements.forEach(({ trackId, elementId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((c) => c.id === elementId);
      if (element && track) {
        const effectiveStart = element.startTime;
        const effectiveEnd =
          element.startTime +
          (element.duration - element.trimStart - element.trimEnd);

        if (currentTime > effectiveStart && currentTime < effectiveEnd) {
          const newElementId = splitElement(trackId, elementId, currentTime);
          if (newElementId) splitCount++;
        }
      }
    });
    if (splitCount === 0) {
      toast.error("Playhead must be within selected elements to split");
    }
  };

  const handleDuplicateSelected = () => {
    if (selectedElements.length === 0) {
      toast.error("No elements selected");
      return;
    }
    const canDuplicate = selectedElements.length === 1;
    if (!canDuplicate) return;

    const newSelections: { trackId: string; elementId: string }[] = [];

    selectedElements.forEach(({ trackId, elementId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((el) => el.id === elementId);

      if (element) {
        const newStartTime =
          element.startTime +
          (element.duration - element.trimStart - element.trimEnd) +
          0.1;

        // Create element without id (will be generated by store)
        const { id, ...elementWithoutId } = element;

        addElementToTrack(trackId, {
          ...elementWithoutId,
          startTime: newStartTime,
        });

        // We can't predict the new id, so just clear selection for now
        // TODO: addElementToTrack could return the new element id
      }
    });

    clearSelectedElements();
  };

  const handleFreezeSelected = () => {
    toast.info("Freeze frame functionality coming soon!");
  };

  const handleSplitAndKeepLeft = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((c) => c.id === elementId);
    if (!element) return;
    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);
    if (currentTime <= effectiveStart || currentTime >= effectiveEnd) {
      toast.error("Playhead must be within selected element");
      return;
    }
    splitAndKeepLeft(trackId, elementId, currentTime);
  };

  const handleSplitAndKeepRight = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((c) => c.id === elementId);
    if (!element) return;
    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);
    if (currentTime <= effectiveStart || currentTime >= effectiveEnd) {
      toast.error("Playhead must be within selected element");
      return;
    }
    splitAndKeepRight(trackId, elementId, currentTime);
  };

  const handleSeparateAudio = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one media element to separate audio");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    if (!track || track.type !== "media") {
      toast.error("Select a media element to separate audio");
      return;
    }
    separateAudio(trackId, elementId);
  };

  const handleDeleteSelected = () => {
    if (selectedElements.length === 0) {
      toast.error("No elements selected");
      return;
    }
    selectedElements.forEach(({ trackId, elementId }) => {
      removeElementFromTrack(trackId, elementId);
    });
    clearSelectedElements();
  };

  // --- Scroll synchronization effect ---
  useEffect(() => {
    const rulerViewport = rulerScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement;
    const tracksViewport = tracksScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement;
    const trackLabelsViewport = trackLabelsScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement;

    if (!rulerViewport || !tracksViewport) return;

    // Horizontal scroll synchronization between ruler and tracks
    const handleRulerScroll = () => {
      const now = Date.now();
      if (isUpdatingRef.current || now - lastRulerSync.current < 16) return;
      lastRulerSync.current = now;
      isUpdatingRef.current = true;
      tracksViewport.scrollLeft = rulerViewport.scrollLeft;
      isUpdatingRef.current = false;
    };
    const handleTracksScroll = () => {
      const now = Date.now();
      if (isUpdatingRef.current || now - lastTracksSync.current < 16) return;
      lastTracksSync.current = now;
      isUpdatingRef.current = true;
      rulerViewport.scrollLeft = tracksViewport.scrollLeft;
      isUpdatingRef.current = false;
    };

    rulerViewport.addEventListener("scroll", handleRulerScroll);
    tracksViewport.addEventListener("scroll", handleTracksScroll);

    // Vertical scroll synchronization between track labels and tracks content
    if (trackLabelsViewport) {
      const handleTrackLabelsScroll = () => {
        const now = Date.now();
        if (isUpdatingRef.current || now - lastVerticalSync.current < 16)
          return;
        lastVerticalSync.current = now;
        isUpdatingRef.current = true;
        tracksViewport.scrollTop = trackLabelsViewport.scrollTop;
        isUpdatingRef.current = false;
      };
      const handleTracksVerticalScroll = () => {
        const now = Date.now();
        if (isUpdatingRef.current || now - lastVerticalSync.current < 16)
          return;
        lastVerticalSync.current = now;
        isUpdatingRef.current = true;
        trackLabelsViewport.scrollTop = tracksViewport.scrollTop;
        isUpdatingRef.current = false;
      };

      trackLabelsViewport.addEventListener("scroll", handleTrackLabelsScroll);
      tracksViewport.addEventListener("scroll", handleTracksVerticalScroll);

      return () => {
        rulerViewport.removeEventListener("scroll", handleRulerScroll);
        tracksViewport.removeEventListener("scroll", handleTracksScroll);
        trackLabelsViewport.removeEventListener(
          "scroll",
          handleTrackLabelsScroll
        );
        tracksViewport.removeEventListener(
          "scroll",
          handleTracksVerticalScroll
        );
      };
    }

    return () => {
      rulerViewport.removeEventListener("scroll", handleRulerScroll);
      tracksViewport.removeEventListener("scroll", handleTracksScroll);
    };
  }, []);

  // Add wheel event listeners with passive: false to allow preventDefault
  useEffect(() => {
    const timelineContainer = timelineRef.current;
    if (!timelineContainer || !isInTimeline) return;

    const handleWheelCapture = (e: WheelEvent) => {
      // Call the existing handleWheel function
      handleWheel(e as any);
    };

    // Add wheel event listener with passive: false to allow preventDefault
    timelineContainer.addEventListener("wheel", handleWheelCapture, { passive: false });

    return () => {
      timelineContainer.removeEventListener("wheel", handleWheelCapture);
    };
  }, [handleWheel, isInTimeline]);

  return (
    <div
      className={`h-full flex flex-col transition-colors duration-200 relative bg-panel rounded-sm overflow-hidden`}
      {...dragProps}
      onMouseEnter={() => setIsInTimeline(true)}
      onMouseLeave={() => setIsInTimeline(false)}
    >
      {/* Toolbar */}
      <div className="border-b flex items-center justify-between px-2 py-1 bg-card z-90">
        <div className="flex items-center gap-1 w-full">
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={toggle}
                  className="mr-2"
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isPlaying ? "Pause (Space)" : "Play (Space)"}
              </TooltipContent>
            </Tooltip>
            <div className="w-px h-6 bg-border mx-1" />
            <div
              className="text-xs text-muted-foreground font-mono px-2"
              style={{ minWidth: "18ch", textAlign: "center" }}
            >
              {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
            </div>
            {tracks.length === 0 && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const trackId = addTrack("media");
                        addElementToTrack(trackId, {
                          type: "media",
                          mediaId: "test",
                          name: "Test Clip",
                          duration: TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
                          startTime: 0,
                          trimStart: 0,
                          trimEnd: 0,
                        });
                      }}
                      className="text-xs"
                    >
                      Add Test Clip
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Add a test clip to try playback
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            <div className="w-px h-6 bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={handleSplitSelected}
                >
                  <Scissors className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split element (Ctrl+S)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={handleSplitAndKeepLeft}
                >
                  <ArrowLeftToLine className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split and keep left (Ctrl+Q)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={handleSplitAndKeepRight}
                >
                  <ArrowRightToLine className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split and keep right (Ctrl+W)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={handleSeparateAudio}
                >
                  <SplitSquareHorizontal className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Separate audio (Ctrl+D)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={handleDuplicateSelected}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Duplicate element (Ctrl+D)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={handleFreezeSelected}
                >
                  <Snowflake className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Freeze frame (F)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="text"
                  size="icon"
                  onClick={handleDeleteSelected}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete element (Delete)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="text" size="icon" onClick={toggleSnapping}>
                  {snappingEnabled ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <LockOpen className="h-4 w-4 text-primary" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Auto snapping</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Timeline Container */}

      {/* Timeline Container with Grid Layout */}
      <div
        ref={timelineRef}
        className="relative h-full w-full overflow-auto border"
        onMouseEnter={() => setIsInTimeline(true)}
        onMouseLeave={() => setIsInTimeline(false)}
        onMouseDown={handleSelectionMouseDown}
        onClick={handleTimelineContentClick}
      >
        <div className="min-w-max min-h-max" style={{ minWidth: `${dynamicTimelineWidth}px` }}>
          <div className={`grid grid-cols-[192px_1fr] ${tracks.length > 0 ? `grid-rows-[20px_repeat(${tracks.length},minmax(0,max-content))]` : 'grid-rows-[20px_1fr]'}`}>

            {/* Top-Left Corner (Empty space above track labels) */}
            <div className="sticky top-0 left-0 border-inset bg-card/[0.99]"></div>

            {/* Top Row (Sticky Ruler Header) */}
            <div
              className="sticky top-0 bg-card/[0.99] border-b border-muted/30 z-[95]"
              onMouseDown={handleSelectionMouseDown}
              onClick={handleTimelineContentClick}
              data-ruler-area
            >
              <div
                ref={rulerRef}
                className="relative h-5 select-none cursor-default pb-1 z-[95]"
                onMouseDown={handleRulerMouseDown}
              >
                {(() => {
                  // Calculate appropriate time interval based on zoom level
                  const getTimeInterval = (zoom: number) => {
                    const pixelsPerSecond =
                      TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoom;
                    if (pixelsPerSecond >= 200) return 0.1; // Every 0.1s when very zoomed in
                    if (pixelsPerSecond >= 100) return 0.5; // Every 0.5s when zoomed in
                    if (pixelsPerSecond >= 50) return 1; // Every 1s at normal zoom
                    if (pixelsPerSecond >= 25) return 2; // Every 2s when zoomed out
                    if (pixelsPerSecond >= 12) return 5; // Every 5s when more zoomed out
                    if (pixelsPerSecond >= 6) return 10; // Every 10s when very zoomed out
                    return 30; // Every 30s when extremely zoomed out
                  };

                  const interval = getTimeInterval(zoomLevel);
                  const markerCount = Math.ceil(duration / interval) + 1;

                  return Array.from({ length: markerCount }, (_, i) => {
                    const time = i * interval;
                    if (time > duration) return null;

                    const isMainMarker =
                      time % (interval >= 1 ? Math.max(1, interval) : 1) === 0;

                    return (
                      <div
                        key={i}
                        className={`absolute top-0 bottom-0 z-[95] ${isMainMarker
                          ? "border-l border-muted-foreground/40"
                          : "border-l border-muted-foreground/20"
                          }`}
                        style={{
                          left: `${time * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel}px`,
                        }}
                      >
                        <span
                          className={`absolute top-1 left-1 text-[0.6rem] z-[95] ${isMainMarker
                            ? "text-muted-foreground font-medium"
                            : "text-muted-foreground/70"
                            }`}
                        >

                          {(() => {
                            const formatTime = (seconds: number) => {
                              const hours = Math.floor(seconds / 3600);
                              const minutes = Math.floor((seconds % 3600) / 60);
                              const secs = seconds % 60;

                              if (hours > 0) {
                                return `${hours}:${minutes.toString().padStart(2, "0")}:${Math.floor(secs).toString().padStart(2, "0")}`;
                              } else if (minutes > 0) {
                                return `${minutes}:${Math.floor(secs).toString().padStart(2, "0")}`;
                              } else if (interval >= 1) {
                                return `${Math.floor(secs)}s`;
                              } else {
                                return `${secs.toFixed(1)}s`;
                              }
                            };
                            return formatTime(time);
                          })()}
                        </span>
                      </div>
                    );
                  }).filter(Boolean);
                })()}
              </div>
            </div>

            {/* Track Rows */}
            {tracks.map((track, index) => (
              <Fragment key={track.id}>
                {/* Left Column (Sticky Track Labels) */}
                <div
                  className="sticky left-0 flex items-center border-b border-panel border-inset group bg-card/[0.99] z-[90]"
                  style={{ height: `${getTrackHeight(track.type)}px` }}
                >
                  <div className="flex items-center gap-2 px-2">
                    <TrackIcon track={track} />
                  </div>
                  {track.muted && (
                    <span className="text-xs text-red-500 font-semibold">
                      Muted
                    </span>
                  )}
                </div>

                {/* Scrollable Track Content */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      className=" h-full"
                      onClick={(e) => {
                        // If clicking empty area (not on a element), deselect all elements
                        if (
                          !(e.target as HTMLElement).closest(
                            ".timeline-element"
                          )
                        ) {
                          clearSelectedElements();
                        }
                      }}
                    >
                      <TimelineTrackContent
                        track={track}
                        zoomLevel={zoomLevel}
                        onSnapPointChange={handleSnapPointChange}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => toggleTrackMute(track.id)}
                    >
                      {track.muted ? "Unmute Track" : "Mute Track"}
                    </ContextMenuItem>
                    <ContextMenuItem>
                      Track settings (soon)
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </Fragment>
            ))}
            {/* Add Track Button - spans full width */}
            <div
              onClick={() => addTrack('media')}
              className="col-span-1 sticky left-0 w-full flex items-center border-b border-muted bg-card/[0.99] hover:bg-card/50 transition-colors cursor-pointer z-[89]"
              style={{ height: `${getTrackHeight("media")}px` }}
            >
              <div className="w-full flex  justify-center items-center">
                <Plus className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>

        {/* Overlay Components */}
        <SelectionBox
          startPos={selectionBox?.startPos || null}
          currentPos={selectionBox?.currentPos || null}
          containerRef={tracksContainerRef}
          isActive={selectionBox?.isActive || false}
        />

        <TimelinePlayhead
          currentTime={currentTime}
          duration={duration}
          zoomLevel={zoomLevel}
          tracks={tracks}
          seek={seek}
          rulerRef={rulerRef}
          rulerScrollRef={rulerScrollRef}
          tracksScrollRef={tracksScrollRef}
          trackLabelsRef={trackLabelsRef}
          timelineRef={timelineRef}
          playheadRef={playheadRef}
          isSnappingToPlayhead={
            showSnapIndicator && currentSnapPoint?.type === "playhead"
          }
        />

        <SnapIndicator
          snapPoint={currentSnapPoint}
          zoomLevel={zoomLevel}
          tracks={tracks}
          timelineRef={timelineRef}
          trackLabelsRef={trackLabelsRef}
          isVisible={showSnapIndicator}
        />
      </div>


      </div>
  );
}

function TrackIcon({ track }: { track: TimelineTrack }) {
  return (
    <>
      {track.type === "media" && (
        <Video className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      )}
      {track.type === "text" && (
        <TypeIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      )}
      {track.type === "audio" && (
        <Music className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      )}
    </>
  );
}
