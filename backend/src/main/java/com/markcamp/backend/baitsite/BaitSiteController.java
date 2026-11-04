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
class BaitSiteController {

	private final BaitSiteService baitSiteService;

	BaitSiteController(BaitSiteService baitSiteService) {
		this.baitSiteService = baitSiteService;
	}

	// The service validates the request, not this method: the access check must run first.
	@PostMapping("/api/projects/{projectId}/bait-sites")
	ResponseEntity<BaitSiteResponse> create(@AuthenticationPrincipal AuthenticatedUser user,
			@PathVariable UUID projectId, @RequestBody CreateBaitSiteRequest request) {
		BaitSiteResponse site = this.baitSiteService.create(user.id(), projectId, request);
		return ResponseEntity.created(URI.create("/api/projects/" + projectId + "/bait-sites/" + site.id())).body(site);
	}

	@GetMapping("/api/projects/{projectId}/bait-sites")
	BaitSiteListResponse list(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID projectId) {
		return new BaitSiteListResponse(this.baitSiteService.list(user.id(), projectId));
	}

	@GetMapping("/api/projects/{projectId}/bait-sites/{baitSiteId}")
	BaitSiteResponse get(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID projectId,
			@PathVariable UUID baitSiteId) {
		return this.baitSiteService.get(user.id(), projectId, baitSiteId);
	}

}
