"use client";

import { FPS_PRESETS } from "@/constants/timeline-constants";
import { useAspectRatio } from "@/hooks/use-aspect-ratio";
import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { Label } from "../../ui/label";
import { ScrollArea } from "../../ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { AudioProperties } from "./audio-properties";
import { MediaProperties } from "./media-properties";
import { TextProperties } from "./text-properties";

export function PropertiesPanel() {
  const { activeProject, updateProjectFps } = useProjectStore();
  const { getDisplayName, canvasSize } = useAspectRatio();
  const { selectedElements, tracks } = useTimelineStore();
  const { mediaItems } = useMediaStore();

  const handleFpsChange = (value: string) => {
    const fps = parseFloat(value);
    if (!isNaN(fps) && fps > 0) {
      updateProjectFps(fps);
    }
  };

  const emptyView = (
    <div className="space-y-4 p-5">
      {/* Media Properties */}
      <div className="flex flex-col gap-3">
        <PropertyItem label="Name:" value={activeProject?.name || ""} />
        <PropertyItem label="Aspect ratio:" value={getDisplayName()} />
        <PropertyItem
          label="Resolution:"
          value={`${canvasSize.width} × ${canvasSize.height}`}
        />
        <div className="flex justify-between items-center">
          <Label className="text-xs text-muted-foreground">Frame rate:</Label>
          <Select
            value={(activeProject?.fps || 30).toString()}
            onValueChange={handleFpsChange}
          >
            <SelectTrigger className="w-32 h-6 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FPS_PRESETS.map(({ value, label }) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  return (
    <ScrollArea className="h-full bg-panel rounded-sm">
      {selectedElements.length > 0
        ? selectedElements.map(({ trackId, elementId }) => {
            const track = tracks.find((t) => t.id === trackId);
            const element = track?.elements.find((e) => e.id === elementId);

            if (element?.type === "text") {
              return (
                <div key={elementId}>
                  <TextProperties element={element} trackId={trackId} />
                </div>
              );
            }
            if (element?.type === "media") {
              const mediaItem = mediaItems.find(
                (item) => item.id === element.mediaId,
              );

              if (mediaItem?.type === "audio") {
                return <AudioProperties key={elementId} element={element} />;
              }

              return (
                <div key={elementId}>
                  <MediaProperties element={element} />
                </div>
              );
            }
            return null;
          })
        : emptyView}
    </ScrollArea>
  );
}

function PropertyItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid justify-between grid-cols-6">
      <Label className="text-xs text-muted-foreground col-span-2">
        {label}
      </Label>
      <span className="text-xs text-right col-span-4 truncate" title={value}>
        {value}
      </span>
    </div>
  );
}
