/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {
			fontFamily: {
				sans: ["Outfit", "system-ui", "sans-serif"],
				mono: ["JetBrains Mono", "monospace"],
			},
			colors: {
				dos: {
					dark: "#0f1419",
					card: "#1a2332",
					elevated: "#243447",
					border: "#2f3d4d",
				},
			},
		},
	},
	plugins: [],
};
