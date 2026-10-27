package com.markcamp.backend.user;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.markcamp.backend.auth.AuthenticatedUser;

@RestController
class MeController {

	@GetMapping("/api/me")
	MeResponse me(@AuthenticationPrincipal AuthenticatedUser user) {
		return new MeResponse(user.id());
	}

}
