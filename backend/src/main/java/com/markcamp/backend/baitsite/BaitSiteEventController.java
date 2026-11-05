package com.markcamp.backend.baitsite;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.markcamp.backend.auth.AuthenticatedUser;

@RestController
class BaitSiteEventController {

	private final BaitSiteEventService eventService;

	BaitSiteEventController(BaitSiteEventService eventService) {
		this.eventService = eventService;
	}

	// The service validates the request, not this method: the access check must run first.
	@PostMapping("/api/projects/{projectId}/bait-sites/{baitSiteId}/events")
	ResponseEntity<BaitSiteEventResponse> record(@AuthenticationPrincipal AuthenticatedUser user,
			@PathVariable UUID projectId, @PathVariable UUID baitSiteId,
			@RequestBody RecordBaitSiteEventRequest request) {
		BaitSiteEventResponse event = this.eventService.recordEvent(user.id(), projectId, baitSiteId, request);
		return ResponseEntity
			.created(URI.create("/api/projects/" + projectId + "/bait-sites/" + baitSiteId + "/events/" + event.id()))
			.body(event);
	}

	@GetMapping("/api/projects/{projectId}/bait-sites/{baitSiteId}/events")
	BaitSiteEventListResponse list(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID projectId,
			@PathVariable UUID baitSiteId) {
		return new BaitSiteEventListResponse(this.eventService.list(user.id(), projectId, baitSiteId));
	}

	@GetMapping("/api/projects/{projectId}/bait-sites/{baitSiteId}/events/{eventId}")
	BaitSiteEventResponse get(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID projectId,
			@PathVariable UUID baitSiteId, @PathVariable UUID eventId) {
		return this.eventService.get(user.id(), projectId, baitSiteId, eventId);
	}

}
