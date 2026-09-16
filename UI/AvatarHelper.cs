using System.Windows;
using System.Windows.Controls;
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

        public static FrameworkElement BuildAvatarElement(ChatData chat, double size)
        {
            if (chat != null && chat.IsGroup && chat.Members != null && chat.Members.Count > 0)
            {
                var grid = new Grid { Width = size, Height = size };
                grid.RowDefinitions.Add(new RowDefinition());
                grid.RowDefinitions.Add(new RowDefinition());
                grid.ColumnDefinitions.Add(new ColumnDefinition());
                grid.ColumnDefinitions.Add(new ColumnDefinition());

                var members = chat.Members.Take(4);

                int i = 0;
                foreach (var member in members)
                {
                    var cell = new Border
                    {
                        Background = GetBrush(member),
                        Child = new TextBlock
                        {
                            Text = GetInitial(member),
                            Foreground = Brushes.White,
                            FontSize = size / 4.2,
                            FontWeight = FontWeights.SemiBold,
                            HorizontalAlignment = HorizontalAlignment.Center,
                            VerticalAlignment = VerticalAlignment.Center
                        }
                    };
                    Grid.SetRow(cell, i / 2);
                    Grid.SetColumn(cell, i % 2);
                    grid.Children.Add(cell);
                    i++;
                }

                return new Border
                {
                    Width = size,
                    Height = size,
                    CornerRadius = new CornerRadius(size / 2),
                    ClipToBounds = true,
                    Background = Brushes.Transparent,
                    Child = grid
                };
            }

            return BuildInitialAvatar(chat?.Username, size);
        }

        public static FrameworkElement BuildInitialAvatar(string name, double size)
        {
            return new Border
            {
                Width = size,
                Height = size,
                CornerRadius = new CornerRadius(size / 2),
                Background = GetBrush(name),
                Child = new TextBlock
                {
                    Text = GetInitial(name),
                    Foreground = Brushes.White,
                    FontSize = size * 0.42,
                    FontWeight = FontWeights.SemiBold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
        }
    }
}
