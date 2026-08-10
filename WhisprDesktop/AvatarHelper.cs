using System.Windows.Media;

namespace WhisprDesktop
{
    public static class AvatarHelper
    {
        private static readonly Color[] Palette =
        {
            Color.FromRgb(0x33, 0x90, 0xEC),
            Color.FromRgb(0x29, 0x7A, 0x4A),
            Color.FromRgb(0xE0, 0x6C, 0x75),
            Color.FromRgb(0x8E, 0x6C, 0xD6),
            Color.FromRgb(0xF0, 0x8C, 0x3A),
            Color.FromRgb(0x43, 0xA0, 0x9E),
            Color.FromRgb(0x70, 0x90, 0xC6),
            Color.FromRgb(0xB7, 0x6C, 0xE8)
        };

        public static string GetInitial(string name)
        {
            if (string.IsNullOrEmpty(name)) return "?";
            return name[0].ToString().ToUpperInvariant();
        }

        public static Brush GetBrush(string name)
        {
            if (string.IsNullOrEmpty(name)) return new SolidColorBrush(Palette[0]);

            int hash = 0;
            foreach (var c in name)
                hash = (hash * 31 + c) & 0x7FFFFFFF;

            return new SolidColorBrush(Palette[hash % Palette.Length]);
        }
    }
}
